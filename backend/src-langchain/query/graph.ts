import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { rewrite } from "./nodes/rewrite.js";
import { intent } from "./nodes/intent.js";
import { retrieve } from "./nodes/retrieve.js";
import { driveLookup } from "./nodes/driveLookup.js";
import { grade } from "./nodes/grade.js";
import { generate } from "./nodes/generate.js";
import { webSearch } from "./nodes/webSearch.js";
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
  docs: Annotation<QuerySource[]>(),
  relevant: Annotation<boolean>(),
  answer: Annotation<string>(),
  sources: Annotation<QuerySource[]>(),
  title: Annotation<string | undefined>(),
});

const graph = new StateGraph(State)
  .addNode("rewrite", rewrite)
  .addNode("intentNode", intent)
  .addNode("retrieve", retrieve)
  .addNode("grade", grade)
  .addNode("driveLookup", driveLookup)
  .addNode("generate", generate)
  .addNode("webSearch", webSearch)
  .addNode("titleNode", title)
  .addEdge(START, "rewrite")
  .addEdge("rewrite", "intentNode")
  // Route on intent: own documents -> retrieve; public question -> web search;
  // otherwise (creative/build/small talk) -> generate from general knowledge
  // with no retrieval or web search (this is what stops creative asks from
  // web-searching and citing a spurious "Web search" source).
  .addConditionalEdges("intentNode", (s) =>
    s.useDrive ? "retrieve" : s.needsWeb ? "webSearch" : "generate",
  )
  .addEdge("retrieve", "grade")
  // Docs relevant -> answer from them. Not relevant: for a document question,
  // try a live Drive lookup; for a public question, the web; otherwise generate
  // (empty context -> the prompt says plainly it couldn't find it in their files).
  .addConditionalEdges("grade", (s) =>
    s.relevant ? "generate" : s.useDrive ? "driveLookup" : s.needsWeb ? "webSearch" : "generate",
  )
  // Drive lookup and web search only gather context; generate is the single
  // terminal answer node, so every reply is formatted by the ported prompt.
  .addEdge("driveLookup", "generate")
  .addEdge("webSearch", "generate")
  .addEdge("generate", "titleNode")
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

// Human, display-ready labels for the graph nodes worth surfacing to the user.
// `titleNode` is intentionally omitted — it runs after the answer is already
// formed, so there is nothing meaningful to report for it. Indonesian to match
// the rest of the chat UI.
const PHASE_LABELS: Record<string, string> = {
  rewrite: "Memahami pertanyaan…",
  intentNode: "Menentukan sumber jawaban…",
  retrieve: "Mencari di dokumen Anda…",
  grade: "Menilai relevansi dokumen…",
  driveLookup: "Membaca dari Google Drive…",
  webSearch: "Menelusuri web…",
  generate: "Menyusun jawaban…",
};

// Streaming variant of runQuery. Runs the identical graph but observes it with
// two stream modes at once:
//   - "updates" yields `{ [nodeName]: partialState }` after each node runs — we
//     report the node as a phase and merge its partial state into an accumulator
//     (every channel is last-write-wins, so replaying the updates reconstructs
//     the same final state `invoke` would return).
//   - "messages" yields `[messageChunk, metadata]` for every LLM token as it is
//     produced — we forward only the answer model's tokens (metadata tags them
//     with the `generate` node) so the client can render the reply as it writes.
export async function runQueryStream(
  conversationId: string,
  question: string,
  history: ChatTurn[],
  generateTitle: boolean,
  onPhase: (phase: QueryPhase) => void,
  onToken: (text: string) => void = () => {},
): Promise<QueryResult> {
  const acc: Record<string, unknown> = {};
  const stream = await graph.stream(
    { conversationId, question, history, generateTitle },
    { streamMode: ["updates", "messages"] },
  );
  for await (const part of stream) {
    // With an array streamMode each item is a `[mode, data]` tuple; cast through
    // unknown so this compiles regardless of the exact stream typing.
    const [mode, data] = part as unknown as [string, unknown];
    if (mode === "updates") {
      for (const [node, partial] of Object.entries(data as Record<string, unknown>)) {
        const label = PHASE_LABELS[node];
        if (label) onPhase({ key: node, label });
        if (partial && typeof partial === "object") Object.assign(acc, partial);
      }
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
    answer: (acc.answer as string) ?? "",
    sources: (acc.sources as QuerySource[]) ?? [],
    title: acc.title as string | undefined,
  };
}
