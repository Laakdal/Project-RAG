import { describe, it, expect, vi, beforeEach } from "vitest";

const rewrite = vi.fn(async (s: { question: string }) => ({ rewritten: s.question }));
vi.mock("./nodes/rewrite.js", () => ({ rewrite }));
const intent = vi.fn(async () => ({ useDrive: true, needsWeb: false }));
vi.mock("./nodes/intent.js", () => ({ intent }));
const retrieve = vi.fn(async () => ({ docs: [{ filename: "d", chunkIndex: 0, text: "t" }] }));
vi.mock("./nodes/retrieve.js", () => ({ retrieve }));
const grade = vi.fn(async () => ({ relevant: true }));
vi.mock("./nodes/grade.js", () => ({ grade }));
const generate = vi.fn(async () => ({ answer: "from-docs", sources: [{ filename: "d", chunkIndex: 0, text: "t" }] }));
vi.mock("./nodes/generate.js", () => ({ generate }));
const webSearch = vi.fn(async () => ({ docs: [{ filename: "Web search", chunkIndex: 0, text: "web ctx" }] }));
vi.mock("./nodes/webSearch.js", () => ({ webSearch }));
const driveLookup = vi.fn(async () => ({ docs: [{ filename: "SOP.pdf", chunkIndex: 0, text: "drive ctx" }] }));
vi.mock("./nodes/driveLookup.js", () => ({ driveLookup }));
vi.mock("./nodes/title.js", () => ({ title: vi.fn(async () => ({ title: "T" })) }));

describe("runQuery graph", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    intent.mockResolvedValue({ useDrive: true, needsWeb: false });
    grade.mockResolvedValue({ relevant: true });
  });

  it("useDrive: retrieves and answers from docs when relevant", async () => {
    intent.mockResolvedValueOnce({ useDrive: true, needsWeb: false });
    grade.mockResolvedValueOnce({ relevant: true });
    const { runQuery } = await import("./graph.js");
    const r = await runQuery("c1", "q", [], true);
    expect(retrieve).toHaveBeenCalled();
    expect(r.answer).toBe("from-docs");
    expect(r.title).toBe("T");
  });

  it("useDrive with irrelevant library results falls back to live Drive lookup", async () => {
    intent.mockResolvedValueOnce({ useDrive: true, needsWeb: false });
    grade.mockResolvedValueOnce({ relevant: false });
    const { runQuery } = await import("./graph.js");
    const r = await runQuery("c1", "apa isi SOP IT", [], false);
    expect(driveLookup).toHaveBeenCalled();
    expect(webSearch).not.toHaveBeenCalled();
    expect(r.answer).toBe("from-docs");
  });

  it("public question routes straight to web search, skipping retrieve", async () => {
    intent.mockResolvedValueOnce({ useDrive: false, needsWeb: true });
    const { runQuery } = await import("./graph.js");
    const r = await runQuery("c1", "apa itu css", [], false);
    expect(retrieve).not.toHaveBeenCalled();
    expect(webSearch).toHaveBeenCalled();
    expect(r.answer).toBe("from-docs");
  });

  it("creative task generates directly, skipping retrieve and web search", async () => {
    intent.mockResolvedValueOnce({ useDrive: false, needsWeb: false });
    const { runQuery } = await import("./graph.js");
    const r = await runQuery("c1", "buatkan flowchart", [], false);
    expect(retrieve).not.toHaveBeenCalled();
    expect(webSearch).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalled();
    expect(r.answer).toBe("from-docs");
  });
});
