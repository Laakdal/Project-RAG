import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../query/nodes/rewrite.js", () => ({
  rewrite: vi.fn(async (s: { question: string }) => ({ rewritten: s.question })),
}));
const similaritySearch = vi.fn();
vi.mock("../shared/qdrant.js", () => ({ getLibraryVectorStore: vi.fn(async () => ({ similaritySearch })) }));
vi.mock("../query/nodes/generate.js", () => ({
  generate: vi.fn(async (s: { docs: unknown[] }) => ({ answer: "lib answer", sources: s.docs })),
}));

describe("queryLibrary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("searches the library and maps drive citations", async () => {
    similaritySearch.mockResolvedValue([
      { pageContent: "chunk", metadata: { filename: "doc.pdf", webUrl: "https://drive/x", chunkIndex: 2 } },
    ]);
    const { queryLibrary } = await import("./query.js");
    const r = await queryLibrary("q", []);
    expect(r.answer).toBe("lib answer");
    expect(r.sources[0]).toEqual({ filename: "doc.pdf", webUrl: "https://drive/x", chunkIndex: 2, text: "chunk" });
    expect((similaritySearch.mock.calls[0] as unknown[])[1]).toBe(8);
  });

  it("returns a no-results message when nothing matches", async () => {
    similaritySearch.mockResolvedValue([]);
    const { queryLibrary } = await import("./query.js");
    const r = await queryLibrary("q", []);
    expect(r.sources).toEqual([]);
    expect(r.answer).toMatch(/couldn't find/i);
  });
});
