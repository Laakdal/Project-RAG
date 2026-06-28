import { describe, it, expect, vi, beforeEach } from "vitest";

const fromExisting = vi.fn(async () => ({ tag: "store" }));
vi.mock("@langchain/qdrant", () => ({
  QdrantVectorStore: { fromExistingCollection: fromExisting },
}));
vi.mock("./models.js", () => ({ makeEmbeddings: () => ({ tag: "emb" }) }));

const MOCK_CONFIG = {
  config: {
    QDRANT_URL: "http://qdrant-test",
    QDRANT_COLLECTION_LG: "project_rag_chat_lg",
  },
};
vi.mock("../../src/config.js", () => MOCK_CONFIG);

describe("getVectorStore", () => {
  beforeEach(() => vi.clearAllMocks());

  it("binds to the langgraph collection with the configured URL", async () => {
    const { getVectorStore } = await import("./qdrant.js");
    await getVectorStore();
    const args = fromExisting.mock.calls[0] as unknown as [unknown, { collectionName: string; url: string }];
    const opts = args[1];
    expect(opts.collectionName).toBe("project_rag_chat_lg");
    expect(opts.url).toBe(MOCK_CONFIG.config.QDRANT_URL);
  });
});
