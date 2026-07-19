import { config } from "../config.js";
import * as n8n from "./n8n-client.js";
import type { ChatTurn, QueryResult, IngestResult, QuerySource, QueryPhase } from "./types.js";

// Dispatch on the global RAG_PROVIDER switch. The langgraph module is imported
// lazily so its heavy LangChain deps load only when actually selected (the n8n
// default path and most tests never touch them).
async function langgraph() {
  const mod = await import("../../src-langchain/index.js");
  return mod.langgraphProvider;
}

export async function queryRag(
  conversationId: string,
  question: string,
  history: ChatTurn[] = [],
  generateTitle = false,
  libraryDocs: QuerySource[] = [],
  skipDrive = false,
): Promise<QueryResult> {
  if (config.RAG_PROVIDER === "langgraph") {
    // langgraph path does not consume libraryDocs or the skip-drive hint; the
    // backend-driven library enriches the n8n path only.
    return (await langgraph()).queryRag(conversationId, question, history, generateTitle);
  }
  return n8n.queryRag(conversationId, question, history, generateTitle, libraryDocs, skipDrive);
}

// Streaming query: reports each pipeline step through `onPhase`, then resolves
// with the final answer. The langgraph provider observes its in-process graph;
// the n8n provider has no graph to watch, so it emits a single generic phase and
// answers through the normal (non-streaming) call.
export async function queryRagStream(
  conversationId: string,
  question: string,
  history: ChatTurn[] = [],
  generateTitle = false,
  onPhase: (phase: QueryPhase) => void = () => {},
  onToken: (text: string) => void = () => {},
): Promise<QueryResult> {
  if (config.RAG_PROVIDER === "langgraph") {
    return (await langgraph()).queryRagStream!(
      conversationId,
      question,
      history,
      generateTitle,
      onPhase,
      onToken,
    );
  }
  // n8n has no in-process token stream; report one generic phase and answer
  // non-streamed (the client falls back to showing the whole answer at once).
  onPhase({ key: "generate", label: "Menyusun jawaban…" });
  return n8n.queryRag(conversationId, question, history, generateTitle, [], false);
}

export async function ingestFile(
  conversationId: string,
  filename: string,
  file: Buffer,
  mimeType: string,
): Promise<IngestResult> {
  if (config.RAG_PROVIDER === "langgraph") {
    return (await langgraph()).ingestFile(conversationId, filename, file, mimeType);
  }
  return n8n.ingestFile(conversationId, filename, file, mimeType);
}
