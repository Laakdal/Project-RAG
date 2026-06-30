import { describe, it, expect, vi, beforeEach } from "vitest";

const addDocuments = vi.fn(async () => undefined);
const clientDelete = vi.fn(async () => undefined);
const fromExisting = vi.fn(async () => ({ addDocuments, client: { delete: clientDelete } }));
vi.mock("@langchain/qdrant", () => ({
  QdrantVectorStore: { fromExistingCollection: fromExisting },
}));
vi.mock("./models.js", () => ({ makeEmbeddings: () => ({ tag: "emb" }) }));

const MOCK_CONFIG = {
  config: {
    QDRANT_URL: "http://qdrant-test",
    QDRANT_COLLECTION_LG: "project_rag_chat_lg",
    QDRANT_COLLECTION_LIBRARY: "project_rag_library",
  },
};
vi.mock("../../src/config.js", () => MOCK_CONFIG);

beforeEach(() => vi.clearAllMocks());

describe("getVectorStore", () => {
  it("binds to the langgraph collection with the configured URL", async () => {
    const { getVectorStore } = await import("./qdrant.js");
    await getVectorStore();
    const args = fromExisting.mock.calls[0] as unknown as [unknown, { collectionName: string; url: string }];
    expect(args[1].collectionName).toBe("project_rag_chat_lg");
    expect(args[1].url).toBe(MOCK_CONFIG.config.QDRANT_URL);
  });
});

describe("library helpers", () => {
  it("getLibraryVectorStore binds the library collection", async () => {
    const { getLibraryVectorStore } = await import("./qdrant.js");
    await getLibraryVectorStore();
    const calls = fromExisting.mock.calls as unknown as [unknown, { collectionName: string }][];
    expect(calls[calls.length - 1][1].collectionName).toBe("project_rag_library");
  });

  it("upsertLibraryDocuments adds documents and skips when empty", async () => {
    const { upsertLibraryDocuments } = await import("./qdrant.js");
    await upsertLibraryDocuments([]);
    expect(addDocuments).not.toHaveBeenCalled();
    await upsertLibraryDocuments([{ pageContent: "x", metadata: {} } as never]);
    expect(addDocuments).toHaveBeenCalledTimes(1);
  });

  it("deleteLibraryFile deletes points filtered by metadata.driveFileId", async () => {
    const { deleteLibraryFile } = await import("./qdrant.js");
    await deleteLibraryFile("file-123");
    expect(clientDelete).toHaveBeenCalledTimes(1);
    const [collection, body] = clientDelete.mock.calls[0] as unknown as [
      string,
      { filter: { must: { key: string; match: { value: string } }[] } },
    ];
    expect(collection).toBe("project_rag_library");
    expect(body.filter.must[0].key).toBe("metadata.driveFileId");
    expect(body.filter.must[0].match.value).toBe("file-123");
  });
});
