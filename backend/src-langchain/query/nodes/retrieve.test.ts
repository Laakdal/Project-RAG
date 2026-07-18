import { describe, it, expect, vi, beforeEach } from "vitest";

const chatSearch = vi.fn();
const librarySearch = vi.fn();
vi.mock("../../shared/qdrant.js", () => ({
  getVectorStore: vi.fn(async () => ({ similaritySearchWithScore: chatSearch })),
  getLibraryVectorStore: vi.fn(async () => ({ similaritySearchWithScore: librarySearch })),
}));

const chatDoc = { pageContent: "chunk text", metadata: { filename: "doc.pdf", chunkIndex: 2 } };
const libDoc = { pageContent: "library text", metadata: { filename: "lib.pdf", chunkIndex: 0, webUrl: "http://drive/x" } };

describe("retrieve node", () => {
  beforeEach(() => vi.clearAllMocks());

  it("scopes the per-chat search to the conversation", async () => {
    chatSearch.mockResolvedValueOnce([[chatDoc, 0.6]]);
    librarySearch.mockResolvedValueOnce([]);
    const { retrieve } = await import("./retrieve.js");
    await retrieve({ rewritten: "q", conversationId: "c1" } as never);
    const [, k, filter] = chatSearch.mock.calls[0] as unknown as [string, number, unknown];
    expect(k).toBe(5);
    expect(JSON.stringify(filter)).toContain("c1");
  });

  it("keeps a strongly-relevant upload and drops off-topic library noise", async () => {
    chatSearch.mockResolvedValueOnce([[chatDoc, 0.55]]);
    librarySearch.mockResolvedValueOnce([[libDoc, 0.49]]); // below the upload -> noise
    const { retrieve } = await import("./retrieve.js");
    const out = await retrieve({ rewritten: "q", conversationId: "c1" } as never);
    expect(out.docs.map((d) => d.filename)).toEqual(["doc.pdf"]);
  });

  it("uses the library when the per-chat upload is not relevant", async () => {
    chatSearch.mockResolvedValueOnce([[chatDoc, 0.2]]); // below the floor
    librarySearch.mockResolvedValueOnce([[libDoc, 0.6]]);
    const { retrieve } = await import("./retrieve.js");
    const out = await retrieve({ rewritten: "q", conversationId: "c1" } as never);
    expect(out.docs).toEqual([
      { filename: "lib.pdf", chunkIndex: 0, text: "library text", webUrl: "http://drive/x" },
    ]);
  });

  it("keeps library docs that are more relevant than the upload", async () => {
    chatSearch.mockResolvedValueOnce([[chatDoc, 0.55]]);
    librarySearch.mockResolvedValueOnce([[libDoc, 0.7]]); // beats the upload -> kept
    const { retrieve } = await import("./retrieve.js");
    const out = await retrieve({ rewritten: "q", conversationId: "c1" } as never);
    expect(out.docs.map((d) => d.filename)).toEqual(["doc.pdf", "lib.pdf"]);
  });

  it("drops matches below the floor from both sources", async () => {
    chatSearch.mockResolvedValueOnce([[chatDoc, 0.3]]);
    librarySearch.mockResolvedValueOnce([[libDoc, 0.3]]);
    const { retrieve } = await import("./retrieve.js");
    const out = await retrieve({ rewritten: "q", conversationId: "c1" } as never);
    expect(out.docs).toEqual([]);
  });

  it("still returns per-chat docs when the library search fails", async () => {
    chatSearch.mockResolvedValueOnce([[chatDoc, 0.6]]);
    librarySearch.mockRejectedValueOnce(new Error("no library collection"));
    const { retrieve } = await import("./retrieve.js");
    const out = await retrieve({ rewritten: "q", conversationId: "c1" } as never);
    expect(out.docs.map((d) => d.filename)).toEqual(["doc.pdf"]);
  });
});
