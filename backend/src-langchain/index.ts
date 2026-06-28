import type { RagProvider } from "../src/rag/types.js";

// Stub — replaced by the real implementation in a later milestone (Task 17).
// Only reached when RAG_PROVIDER=langgraph, which is not the default, so these
// throwers are never invoked in Milestone 1.
export const langgraphProvider: RagProvider = {
  async ingestFile() {
    throw new Error("langgraph provider not implemented yet");
  },
  async queryRag() {
    throw new Error("langgraph provider not implemented yet");
  },
};
