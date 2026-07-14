// backend/src/rag/attachment-vectors.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config.js", () => ({
  config: {
    QDRANT_URL: "http://qdrant:6333",
    OPENAI_API_KEY: "test-key",
    EMBED_MODEL: "text-embedding-3-small",
    QDRANT_COLLECTION_CHAT: "rag_chat_chunks",
  },
}));

const ensureCollection = vi.hoisted(() => vi.fn(async () => {}));
const addDocuments = vi.hoisted(() => vi.fn(async (_docs: unknown[]) => {}));
const similaritySearchWithScore = vi.hoisted(() =>
  vi.fn(async (_q: string, _k?: number, _filter?: unknown): Promise<[{ pageContent: string; metadata: Record<string, unknown> }, number][]> => []),
);
const clientDelete = vi.hoisted(() => vi.fn(async () => {}));

// Mock the langchain classes as real (newable) classes wired to the spies above.
vi.mock("@langchain/qdrant", () => ({
  QdrantVectorStore: class {
    ensureCollection = ensureCollection;
    addDocuments = addDocuments;
    similaritySearchWithScore = similaritySearchWithScore;
    client = { delete: clientDelete };
  },
}));
vi.mock("@langchain/openai", () => ({ OpenAIEmbeddings: class {} }));

beforeEach(() => {
  ensureCollection.mockClear();
  addDocuments.mockClear();
  similaritySearchWithScore.mockReset();
  clientDelete.mockClear();
});

describe("attachment-vectors", () => {
  it("embedAttachment chunks text and stores conversation-scoped documents", async () => {
    const { embedAttachment } = await import("./attachment-vectors.js");
    const longText = "This is a sentence with real words. ".repeat(120); // ~4KB → many chunks
    const n = await embedAttachment("conv-1", "att-1", "book.pdf", longText);

    expect(n).toBeGreaterThan(1);
    expect(addDocuments).toHaveBeenCalledTimes(1);
    const docs = addDocuments.mock.calls[0][0] as { metadata: Record<string, unknown> }[];
    expect(docs[0].metadata).toMatchObject({
      conversationId: "conv-1",
      attachmentId: "att-1",
      filename: "book.pdf",
      chunkIndex: 0,
    });
  });

  it("embedAttachment batches large upserts to stay under Qdrant's request limit", async () => {
    const { embedAttachment } = await import("./attachment-vectors.js");
    const huge = "word ".repeat(80000); // ~400KB → far more than one 256-doc batch
    const n = await embedAttachment("c", "a", "big.pdf", huge);
    expect(n).toBeGreaterThan(256);
    expect(addDocuments.mock.calls.length).toBeGreaterThan(1);
  });

  it("embedAttachment stores nothing for blank text", async () => {
    const { embedAttachment } = await import("./attachment-vectors.js");
    expect(await embedAttachment("c", "a", "f.pdf", "   ")).toBe(0);
    expect(addDocuments).not.toHaveBeenCalled();
  });

  it("retrieveAttachmentChunks returns chunks filtered by conversation", async () => {
    similaritySearchWithScore.mockResolvedValue([
      [{ pageContent: "chunk A", metadata: { filename: "book.pdf" } }, 0.9],
      [{ pageContent: "chunk B", metadata: { filename: "book.pdf" } }, 0.8],
    ]);
    const { retrieveAttachmentChunks } = await import("./attachment-vectors.js");
    const out = await retrieveAttachmentChunks("conv-1", "what is X?", 8);

    expect(out).toEqual([
      { filename: "book.pdf", text: "chunk A", score: 0.9 },
      { filename: "book.pdf", text: "chunk B", score: 0.8 },
    ]);
    expect(similaritySearchWithScore.mock.calls[0][2]).toEqual({
      must: [{ key: "metadata.conversationId", match: { value: "conv-1" } }],
    });
  });
});
