import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config.js", () => ({
  config: { QDRANT_URL: "http://qdrant:6333", QDRANT_COLLECTION_LIBRARY: "lib" },
}));
vi.mock("./embeddings.js", () => ({ makeEmbeddings: () => ({}) }));

const addDocuments = vi.fn(async (_docs: Array<{ metadata: Record<string, unknown> }>) => {});
const ensureCollection = vi.fn(async () => {});
const similaritySearchWithScore = vi.fn(async () => [
  [{ pageContent: "chunk a", metadata: { filename: "a.pdf", chunkIndex: 0 } }, 0.9],
]);
const clientDelete = vi.fn(async () => {});

vi.mock("@langchain/qdrant", () => ({
  QdrantVectorStore: class {
    client = { delete: clientDelete };
    addDocuments = addDocuments;
    ensureCollection = ensureCollection;
    similaritySearchWithScore = similaritySearchWithScore;
  },
}));

const { upsertChunks, search, deleteBySource } = await import("./vector-store.js");

describe("library vector-store", () => {
  beforeEach(() => vi.clearAllMocks());

  it("upsertChunks embeds and adds one document per chunk", async () => {
    await upsertChunks("doc-1", "a.pdf", "upload", ["chunk a", "chunk b"]);
    expect(ensureCollection).toHaveBeenCalled();
    const docs = addDocuments.mock.calls[0][0];
    expect(docs).toHaveLength(2);
    expect(docs[0].metadata).toMatchObject({ sourceId: "doc-1", filename: "a.pdf", chunkIndex: 0, source: "upload" });
  });

  it("upsertChunks is a no-op for empty chunks", async () => {
    await upsertChunks("doc-1", "a.pdf", "upload", []);
    expect(addDocuments).not.toHaveBeenCalled();
  });

  it("search maps results to hits with scores", async () => {
    const hits = await search("q", 8);
    expect(hits[0]).toEqual({ filename: "a.pdf", chunkIndex: 0, text: "chunk a", score: 0.9 });
  });

  it("deleteBySource filters on the sourceId payload", async () => {
    await deleteBySource("doc-1");
    expect(clientDelete).toHaveBeenCalledWith("lib", {
      filter: { must: [{ key: "metadata.sourceId", match: { value: "doc-1" } }] },
    });
  });
});
