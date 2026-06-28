import { describe, it, expect, vi, beforeEach } from "vitest";

const similaritySearch = vi.fn(async () => [
  { pageContent: "chunk text", metadata: { filename: "doc.pdf", chunkIndex: 2 } },
]);
vi.mock("../../shared/qdrant.js", () => ({
  getVectorStore: vi.fn(async () => ({ similaritySearch })),
}));

describe("retrieve node", () => {
  beforeEach(() => vi.clearAllMocks());

  it("searches scoped to the conversation and maps to sources", async () => {
    const { retrieve } = await import("./retrieve.js");
    const out = await retrieve({ rewritten: "q", conversationId: "c1" } as never);
    expect(out.docs[0]).toEqual({ filename: "doc.pdf", chunkIndex: 2, text: "chunk text" });
    const [, k, filter] = similaritySearch.mock.calls[0] as unknown as [string, number, unknown];
    expect(k).toBe(5);
    expect(JSON.stringify(filter)).toContain("c1");
  });
});
