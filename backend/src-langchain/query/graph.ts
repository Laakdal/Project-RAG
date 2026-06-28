import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { rewrite } from "./nodes/rewrite.js";
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
  docs: Annotation<QuerySource[]>(),
  relevant: Annotation<boolean>(),
  answer: Annotation<string>(),
  sources: Annotation<QuerySource[]>(),
  title: Annotation<string | undefined>(),
});

const graph = new StateGraph(State)
  .addNode("rewrite", rewrite)
  .addNode("retrieve", retrieve)
  .addNode("grade", grade)
  .addNode("generate", generate)
  .addNode("webSearch", webSearch)
  .addNode("titleNode", title)
  .addEdge(START, "rewrite")
  .addEdge("rewrite", "retrieve")
  .addEdge("retrieve", "grade")
  .addConditionalEdges("grade", (s) => (s.relevant ? "generate" : "webSearch"))
  .addEdge("generate", "titleNode")
  .addEdge("webSearch", "titleNode")
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
