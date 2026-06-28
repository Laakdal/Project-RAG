import { ingest } from "./ingest/pipeline.js";
import { runQuery } from "./query/graph.js";
import { requireLanggraphEnv } from "./shared/models.js";
import type { RagProvider } from "../src/rag/types.js";

export const langgraphProvider: RagProvider = {
  async ingestFile(conversationId, filename, file, mimeType) {
    requireLanggraphEnv();
    return ingest(conversationId, filename, file, mimeType);
  },
  async queryRag(conversationId, question, history, generateTitle) {
    requireLanggraphEnv();
    return runQuery(conversationId, question, history, generateTitle);
  },
};
