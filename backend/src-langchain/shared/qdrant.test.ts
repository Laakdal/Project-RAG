import { describe, it, expect, vi, beforeEach } from "vitest";

const fromExisting = vi.fn(async () => ({ tag: "store" }));
vi.mock("@langchain/qdrant", () => ({
  QdrantVectorStore: { fromExistingCollection: fromExisting },
}));
vi.mock("./models.js", () => ({ makeEmbeddings: () => ({ tag: "emb" }) }));

describe("getVectorStore", () => {
  beforeEach(() => vi.clearAllMocks());
  it("binds to the langgraph collection", async () => {
    const { getVectorStore } = await import("./qdrant.js");
    await getVectorStore();
    const [, opts] = fromExisting.mock.calls[0];
    expect(opts.collectionName).toBe("project_rag_chat_lg");
  });
});
