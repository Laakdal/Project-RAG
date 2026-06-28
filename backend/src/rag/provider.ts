import { config } from "../config.js";
import * as n8n from "./n8n-client.js";
import type { ChatTurn, QueryResult, IngestResult } from "./types.js";

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
): Promise<QueryResult> {
  if (config.RAG_PROVIDER === "langgraph") {
    return (await langgraph()).queryRag(conversationId, question, history, generateTitle);
  }
  return n8n.queryRag(conversationId, question, history, generateTitle);
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
