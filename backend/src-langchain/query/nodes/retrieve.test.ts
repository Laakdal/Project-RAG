import { describe, it, expect, vi, beforeEach } from "vitest";

const chatSearch = vi.fn(async () => [
  { pageContent: "chunk text", metadata: { filename: "doc.pdf", chunkIndex: 2 } },
]);
const librarySearch = vi.fn(async () => [
  { pageContent: "library text", metadata: { filename: "lib.pdf", chunkIndex: 0, webUrl: "http://drive/x" } },
]);
vi.mock("../../shared/qdrant.js", () => ({
  getVectorStore: vi.fn(async () => ({ similaritySearch: chatSearch })),
  getLibraryVectorStore: vi.fn(async () => ({ similaritySearch: librarySearch })),
}));

describe("retrieve node", () => {
  beforeEach(() => vi.clearAllMocks());

  it("searches per-chat scoped to the conversation and merges library results", async () => {
    const { retrieve } = await import("./retrieve.js");
    const out = await retrieve({ rewritten: "q", conversationId: "c1" } as never);
    expect(out.docs[0]).toEqual({ filename: "doc.pdf", chunkIndex: 2, text: "chunk text", webUrl: undefined });
    expect(out.docs[1]).toEqual({ filename: "lib.pdf", chunkIndex: 0, text: "library text", webUrl: "http://drive/x" });
    const [, k, filter] = chatSearch.mock.calls[0] as unknown as [string, number, unknown];
    expect(k).toBe(5);
    expect(JSON.stringify(filter)).toContain("c1");
  });

  it("still returns per-chat docs when the library search fails", async () => {
    librarySearch.mockRejectedValueOnce(new Error("no library collection"));
    const { retrieve } = await import("./retrieve.js");
    const out = await retrieve({ rewritten: "q", conversationId: "c1" } as never);
    expect(out.docs).toHaveLength(1);
    expect(out.docs[0].filename).toBe("doc.pdf");
  });
});
