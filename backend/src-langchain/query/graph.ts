import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { rewrite } from "./nodes/rewrite.js";
import { intent } from "./nodes/intent.js";
import { retrieve } from "./nodes/retrieve.js";
import { driveLookup } from "./nodes/driveLookup.js";
import { grade } from "./nodes/grade.js";
import { generate } from "./nodes/generate.js";
import { webSearch } from "./nodes/webSearch.js";
import { noMatch } from "./nodes/noMatch.js";
import { title } from "./nodes/title.js";
import type { ChatTurn, QueryResult, QuerySource, QueryPhase } from "../../src/rag/types.js";

const State = Annotation.Root({
  conversationId: Annotation<string>(),
  question: Annotation<string>(),
  history: Annotation<ChatTurn[]>(),
  generateTitle: Annotation<boolean>(),
  rewritten: Annotation<string>(),
  useDrive: Annotation<boolean>(),
  needsWeb: Annotation<boolean>(),
  needsReasoning: Annotation<boolean>(),
  hasAttachments: Annotation<boolean>(),
  docs: Annotation<QuerySource[]>(),
  confident: Annotation<boolean>(),
  relevant: Annotation<boolean>(),
  answer: Annotation<string>(),
  sources: Annotation<QuerySource[]>(),
  title: Annotation<string | undefined>(),
});

// Human, display-ready labels for the graph nodes worth surfacing to the user.
// `titleNode` is intentionally omitted — it runs after the answer is already
// formed, so there is nothing meaningful to report for it. These are UI chrome
// and stay in English regardless of the question's language; the ANSWER itself
// still follows the user's language (see the writing rules in generate.ts).
const PHASE_LABELS: Record<string, string> = {
  // rewrite and intentNode run concurrently, so both fire at the same instant
  // and the UI would flicker between two labels. They share one label describing
  // what that combined step actually does.
  rewrite: "Understanding your question…",
  intentNode: "Understanding your question…",
  retrieve: "Searching your documents…",
  grade: "Checking how relevant they are…",
  driveLookup: "Reading from Google Drive…",
  webSearch: "Searching the web…",
  generate: "Writing the answer…",
};

// Wrap a node so it announces its phase the moment it STARTS, via the per-run
// `onPhase` callback carried in config.configurable. This fixes the lingering
// label problem: streamMode "updates" only reports a node AFTER it finishes, so
// during a slow node (e.g. a 20s Drive read) the PREVIOUS label would stay up.
// Emitting at entry means the label always matches the step actually running.
// The non-streaming runQuery path passes no callback, so this is a no-op there.
type PhaseConfig = { configurable?: { onPhase?: (p: QueryPhase) => void } };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function phaseNode<S, R>(key: string, fn: (state: S, config?: any) => R) {
  const label = PHASE_LABELS[key];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (state: S, config?: any): R => {
    if (label) (config as PhaseConfig | undefined)?.configurable?.onPhase?.({ key, label });
    return fn(state, config);
  };
}

const graph = new StateGraph(State)
  .addNode("rewrite", phaseNode("rewrite", rewrite))
  .addNode("intentNode", phaseNode("intentNode", intent))
  .addNode("retrieve", phaseNode("retrieve", retrieve))
  .addNode("grade", phaseNode("grade", grade))
  .addNode("driveLookup", phaseNode("driveLookup", driveLookup))
  .addNode("generate", phaseNode("generate", generate))
  .addNode("webSearch", phaseNode("webSearch", webSearch))
  // No phase label (like titleNode): it is a terminal refusal, nothing to report.
  .addNode("noMatch", phaseNode("noMatch", noMatch))
  .addNode("titleNode", phaseNode("titleNode", title))
  // `route` is an empty join node: LangGraph runs a node once ALL its inbound
  // edges have completed, so this is what makes rewrite and intentNode a
  // concurrent pair rather than a chain. They are independent — intent reads
  // question/history/docs and never touches `rewritten` — so running them in
  // sequence just added a whole LLM round trip to every query.
  .addNode("route", () => ({}))
  .addEdge(START, "rewrite")
  .addEdge(START, "intentNode")
  .addEdge("rewrite", "route")
  .addEdge("intentNode", "route")
  // Route on intent: own documents -> retrieve; public question -> web search;
  // otherwise (creative/build/small talk) -> generate from general knowledge
  // with no retrieval or web search (this is what stops creative asks from
  // web-searching and citing a spurious "Web search" source).
  //
  // `hasAttachments` overrides the classifier: questions about an upload ("gambar
  // apa ini") are classified false/false, which was right in n8n where the file's
  // text was already inline, but here it would skip the only node that loads it.
  // Retrieval is conversation-scoped, so if nothing matches, the grade edge below
  // still falls through to Drive or the web exactly as intent asked.
  .addConditionalEdges("route", (s) =>
    s.useDrive || s.hasAttachments ? "retrieve" : s.needsWeb ? "webSearch" : "generate",
  )
  // A retrieval hit at or above the STRONG score needs no second opinion, so
  // skip the grade LLM call and answer from it directly.
  .addConditionalEdges("retrieve", (s) => (s.confident ? "generate" : "grade"))
  // Docs relevant -> answer from them. Not relevant: for a document question,
  // try a live Drive lookup; for a public question, the web; otherwise generate
  // (empty context -> the prompt says plainly it couldn't find it in their files).
  .addConditionalEdges("grade", (s) =>
    s.relevant ? "generate" : s.useDrive ? "driveLookup" : s.needsWeb ? "webSearch" : "generate",
  )
  // Grounded? guard, ported from the live workflow. driveLookup is the sole
  // convergence for the document path (route -> retrieve -> grade -> driveLookup
  // is the only way a useDrive question reaches an empty context), so the guard
  // sits on its out-edge. Live predicate: refuse only when the user asked about
  // their own documents (useDrive), no file is attached (hasAttachments), and
  // every retrieval path came back empty. A web-only or upload question never
  // refuses — it still generates. noMatch answers WITHOUT the LLM, so it cannot
  // fabricate citations.
  .addConditionalEdges("driveLookup", (s) =>
    s.useDrive && !s.hasAttachments && (s.docs?.length ?? 0) === 0
      ? "noMatch"
      : "generate",
  )
  // Web search only gathers context; generate is the single terminal answer
  // node, so every generated reply is formatted by the ported prompt.
  .addEdge("webSearch", "generate")
  .addEdge("generate", "titleNode")
  // The refusal still flows through titleNode so a first message is titled.
  .addEdge("noMatch", "titleNode")
  .addEdge("titleNode", END)
  .compile();

export async function runQuery(
  conversationId: string,
  question: string,
  history: ChatTurn[],
  generateTitle: boolean,
): Promise<QueryResult> {
  const final = await graph.invoke({ conversationId, question, history, generateTitle });
  return {
    answer: final.answer ?? "",
    sources: final.sources ?? [],
    title: final.title,
  };
}

// Streaming variant of runQuery. Runs the identical graph, observed with two
// stream modes at once:
//   - "values" yields the full accumulated state after each super-step; the last
//     one is the final state (answer/sources/title), same as `invoke` returns.
//   - "messages" yields `[messageChunk, metadata]` for every LLM token; we
//     forward only the answer node's tokens (metadata tags them with `generate`)
//     so the client can render the reply as it writes.
// Phases are NOT read from the stream — they are emitted by the phaseNode wrapper
// at node ENTRY (via configurable.onPhase), so a slow node shows its own label
// while it runs instead of the previous node's.
export async function runQueryStream(
  conversationId: string,
  question: string,
  history: ChatTurn[],
  generateTitle: boolean,
  onPhase: (phase: QueryPhase) => void,
  onToken: (text: string) => void = () => {},
): Promise<QueryResult> {
  let lastValues: Record<string, unknown> = {};
  const stream = await graph.stream(
    { conversationId, question, history, generateTitle },
    { streamMode: ["values", "messages"], configurable: { onPhase } },
  );
  for await (const part of stream) {
    // With an array streamMode each item is a `[mode, data]` tuple; cast through
    // unknown so this compiles regardless of the exact stream typing.
    const [mode, data] = part as unknown as [string, unknown];
    if (mode === "values") {
      lastValues = data as Record<string, unknown>;
    } else if (mode === "messages") {
      const [msg, meta] = data as [{ content?: unknown }, { langgraph_node?: string }];
      // Only the answer node's tokens are the reply; other LLM calls (rewrite,
      // intent, grade, title) run in the same graph and must not leak into it.
      // glm-4.6 reasoning deltas carry empty `content`, so this also drops them.
      if (meta?.langgraph_node === "generate" && typeof msg?.content === "string" && msg.content) {
        onToken(msg.content);
      }
    }
  }
  return {
    answer: (lastValues.answer as string) ?? "",
    sources: (lastValues.sources as QuerySource[]) ?? [],
    title: lastValues.title as string | undefined,
  };
}
