import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { rewrite } from "./nodes/rewrite.js";
import { intent } from "./nodes/intent.js";
import { retrieve } from "./nodes/retrieve.js";
import { grade } from "./nodes/grade.js";
import { generate } from "./nodes/generate.js";
import { webSearch } from "./nodes/webSearch.js";
import { title } from "./nodes/title.js";
import type { ChatTurn, QueryResult, QuerySource } from "../../src/rag/types.js";

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
  // Docs relevant -> answer from them. Not relevant: only fall back to the web
  // when intent flagged a public question; otherwise generate (empty context ->
  // the prompt says plainly it couldn't find it in their files).
  .addConditionalEdges("grade", (s) =>
    s.relevant ? "generate" : s.needsWeb ? "webSearch" : "generate",
  )
  // Web search only gathers context; generate is the single terminal answer
  // node, so every reply is formatted by the ported Generate Answer prompt.
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
