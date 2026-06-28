import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./nodes/rewrite.js", () => ({ rewrite: vi.fn(async (s) => ({ rewritten: s.question })) }));
vi.mock("./nodes/retrieve.js", () => ({ retrieve: vi.fn(async () => ({ docs: [{ filename: "d", chunkIndex: 0, text: "t" }] })) }));
const grade = vi.fn(async () => ({ relevant: true }));
vi.mock("./nodes/grade.js", () => ({ grade }));
vi.mock("./nodes/generate.js", () => ({ generate: vi.fn(async () => ({ answer: "from-docs", sources: [{ filename: "d", chunkIndex: 0, text: "t" }] })) }));
vi.mock("./nodes/webSearch.js", () => ({ webSearch: vi.fn(async () => ({ answer: "from-web", sources: [] })) }));
vi.mock("./nodes/title.js", () => ({ title: vi.fn(async () => ({ title: "T" })) }));

describe("runQuery graph", () => {
  beforeEach(() => vi.clearAllMocks());

  it("answers from docs when relevant", async () => {
    grade.mockResolvedValueOnce({ relevant: true });
    const { runQuery } = await import("./graph.js");
    const r = await runQuery("c1", "q", [], true);
    expect(r.answer).toBe("from-docs");
    expect(r.sources).toHaveLength(1);
    expect(r.title).toBe("T");
  });

  it("falls back to web search when not relevant", async () => {
    grade.mockResolvedValueOnce({ relevant: false });
    const { runQuery } = await import("./graph.js");
    const r = await runQuery("c1", "q", [], false);
    expect(r.answer).toBe("from-web");
    expect(r.sources).toEqual([]);
  });
});
