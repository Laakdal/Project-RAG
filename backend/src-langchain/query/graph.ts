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
import { logNodeError } from "../shared/log.js";
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
// `titleNode` is intentionally omitted — it runs on its own branch alongside the
// answer, so it is not a step the user is waiting on. These are UI chrome
// and stay in English regardless of the question's language; the ANSWER itself
// still follows the user's language (see the writing rules in generate.ts).
const PHASE_LABELS: Record<string, string> = {
  // `prepare` classifies intent while it searches, so one label covers the whole
  // combined step rather than flickering between three.
  prepare: "Understanding your question…",
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

type PrepareState = {
  question: string;
  conversationId: string;
  history?: ChatTurn[];
};

// Classify intent WHILE searching, instead of one after the other.
//
// Measured on dev: the intent classifier costs ~3s and retrieval ~2s, and they
// used to run in sequence — ~5s of dead air before the answer model was even
// called. They are independent (intent reads question/history and never touches
// `rewritten`/`docs`), so the retrieval is started speculatively and the two are
// awaited together: the pre-content gap becomes max(3s, 2s) instead of 3s + 2s.
//
// This is composed inside ONE node rather than as parallel graph edges on
// purpose. A rewrite -> retrieve branch is two hops while intent is one, so as
// separate nodes the join fires at different super-steps and both branches write
// `docs` in the same step — LangGraph rejects that ("LastValue can only receive
// one value per step"). Doing it here is deterministic and keeps rewrite feeding
// retrieve, which matters: rewrite turns "dan tanggalnya?" into a standalone
// query, and retrieving on the raw follow-up instead would find much less.
//
// Because retrieval is speculative, the docs are dropped when the classifier
// says this is not a document question — otherwise a greeting or "draw me a
// flowchart" would carry library chunks into generate, which the prompt would
// then be tempted to cite. That is exactly the fabricated-citation failure the
// Grounded? guard exists to prevent.
async function prepare(state: PrepareState) {
  const intentPromise = intent(state);
  const retrievalPromise = (async () => {
    const { rewritten } = await rewrite({
      question: state.question,
      history: state.history ?? [],
    });
    const found = await retrieve({ rewritten, conversationId: state.conversationId });
    return { rewritten, ...found };
  })().catch((error: unknown) => {
    // Retrieval must never fail the whole query — a greeting used to skip these
    // nodes entirely and must not start breaking when they run on every turn.
    logNodeError("prepare (retrieval)", error);
    return { rewritten: state.question, docs: [], confident: false };
  });

  const [classified, retrieved] = await Promise.all([intentPromise, retrievalPromise]);
  const useDocs = classified.useDrive || classified.hasAttachments;
  return {
    ...classified,
    rewritten: retrieved.rewritten,
    docs: useDocs ? retrieved.docs : [],
    confident: useDocs ? retrieved.confident : false,
  };
}

const graph = new StateGraph(State)
  .addNode("prepare", phaseNode("prepare", prepare))
  .addNode("grade", phaseNode("grade", grade))
  .addNode("driveLookup", phaseNode("driveLookup", driveLookup))
  .addNode("generate", phaseNode("generate", generate))
  .addNode("webSearch", phaseNode("webSearch", webSearch))
  // No phase label (like titleNode): it is a terminal refusal, nothing to report.
  .addNode("noMatch", phaseNode("noMatch", noMatch))
  .addNode("titleNode", phaseNode("titleNode", title))
  .addEdge(START, "prepare")
  // Route on intent. Document question -> use what retrieval already found (a hit
  // at or above the STRONG score needs no second opinion, so skip the grade LLM
  // call and answer from it directly). Public question -> web search. Otherwise
  // (creative/build/small talk) -> generate from general knowledge, with the
  // speculative docs already cleared in `prepare` — this is what stops creative
  // asks from citing a library chunk or a spurious "Web search" source.
  //
  // `hasAttachments` overrides the classifier: questions about an upload ("gambar
  // apa ini") are classified false/false, which was right in n8n where the file's
  // text was already inline, but here it would discard the only docs that hold it.
  // Retrieval is conversation-scoped, so if nothing matches, the grade edge below
  // still falls through to Drive or the web exactly as intent asked.
  .addConditionalEdges("prepare", (s) =>
    s.useDrive || s.hasAttachments
      ? s.confident
        ? "generate"
        : "grade"
      : s.needsWeb
        ? "webSearch"
        : "generate",
  )
  // Docs relevant -> answer from them. Not relevant: for a document question,
  // try a live Drive lookup; for a public question, the web; otherwise generate
  // (empty context -> the prompt says plainly it couldn't find it in their files).
  //
  // A file the user attached to THIS chat is the exception, and it is not a
  // tie-breaker but a hard override: `driveLookup` and `webSearch` both return a
  // whole `docs` array, and `docs` is a LastValue channel, so whatever they
  // return REPLACES the upload's chunks. A failed Drive read therefore left
  // generate with empty context and it answered "I can't find your PDF" while
  // the file sat indexed and retrievable. The grader is also the wrong judge
  // here: it sees the top 5 chunks of what may be a 90-chunk thesis, so a "no"
  // says the excerpt is thin, not that the document is irrelevant. When the user
  // deliberately attached a file and retrieval found chunks of it, answer from
  // them rather than going out to Drive or the web.
  .addConditionalEdges("grade", (s) =>
    s.relevant || (s.hasAttachments && (s.docs?.length ?? 0) > 0)
      ? "generate"
      : s.useDrive
        ? "driveLookup"
        : s.needsWeb
          ? "webSearch"
          : "generate",
  )
  // Grounded? guard, ported from the live workflow. driveLookup is the sole
  // convergence for the document path (route -> retrieve -> grade -> driveLookup
  // is the only way a useDrive question reaches an empty context), so the guard
  // sits on its out-edge. Live predicate: refuse only when the user asked about
  // their own documents (useDrive), no file is attached (hasAttachments), and
  // every retrieval path came back empty. A web-only or upload question never
  // refuses — it still generates. noMatch answers WITHOUT the LLM, so it cannot
  // fabricate citations.
  //
  // NOTE the coupling: `docs.length === 0` reads as "Drive found nothing" only
  // because driveLookup REPLACES the channel, discarding the library chunks the
  // grader just rejected — which is what we want on this edge, since those
  // chunks are exactly the ones that produce off-topic citations. If driveLookup
  // is ever changed to merge instead, this guard stops refusing and must switch
  // to a flag reporting what the lookup itself returned.
  .addConditionalEdges("driveLookup", (s) =>
    s.useDrive && !s.hasAttachments && (s.docs?.length ?? 0) === 0
      ? "noMatch"
      : "generate",
  )
  // Title generation depends only on the question, never on the answer, so it
  // runs as its own branch off `prepare` — concurrently with the answer instead
  // of after it. Measured: it costs ~2.5s, and as a tail step that was pure dead
  // time on every new chat (the answer had finished streaming, but the run could
  // not complete, so sources/citations could not render). Run alongside generate
  // it hides completely. It writes only `title`, so it never contends with the
  // answer branch's channels.
  .addEdge("prepare", "titleNode")
  // Web search only gathers context; generate is the single terminal answer
  // node, so every generated reply is formatted by the ported prompt.
  .addEdge("webSearch", "generate")
  .addEdge("generate", END)
  // A refusal is still a first message worth titling — the parallel title branch
  // covers it without the refusal having to pass through it.
  .addEdge("noMatch", END)
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
