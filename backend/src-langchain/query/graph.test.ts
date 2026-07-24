import { describe, it, expect, vi, beforeEach } from "vitest";

const rewrite = vi.fn(async (s: { question: string }) => ({ rewritten: s.question }));
vi.mock("./nodes/rewrite.js", () => ({ rewrite }));
const intent = vi.fn(async () => ({ useDrive: true, needsWeb: false, needsReasoning: false, hasAttachments: false }));
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
    intent.mockResolvedValue({ useDrive: true, needsWeb: false, needsReasoning: false, hasAttachments: false });
    grade.mockResolvedValue({ relevant: true });
    driveLookup.mockResolvedValue({ docs: [{ filename: "SOP.pdf", chunkIndex: 0, text: "drive ctx" }] });
  });

  it("useDrive: retrieves and answers from docs when relevant", async () => {
    intent.mockResolvedValueOnce({ useDrive: true, needsWeb: false, needsReasoning: false, hasAttachments: false });
    grade.mockResolvedValueOnce({ relevant: true });
    const { runQuery } = await import("./graph.js");
    const r = await runQuery("c1", "q", [], true);
    expect(retrieve).toHaveBeenCalled();
    expect(r.answer).toBe("from-docs");
    expect(r.title).toBe("T");
  });

  it("useDrive with irrelevant library results falls back to live Drive lookup", async () => {
    intent.mockResolvedValueOnce({ useDrive: true, needsWeb: false, needsReasoning: false, hasAttachments: false });
    grade.mockResolvedValueOnce({ relevant: false });
    const { runQuery } = await import("./graph.js");
    const r = await runQuery("c1", "apa isi SOP IT", [], false);
    expect(driveLookup).toHaveBeenCalled();
    expect(webSearch).not.toHaveBeenCalled();
    expect(r.answer).toBe("from-docs");
  });

  it("hard-refuses (noMatch) when a useDrive question finds nothing and no file is attached", async () => {
    intent.mockResolvedValueOnce({ useDrive: true, needsWeb: false, needsReasoning: false, hasAttachments: false });
    grade.mockResolvedValueOnce({ relevant: false });
    // Drive lookup also comes up empty -> the Grounded? guard must refuse
    // WITHOUT calling generate (no fabricated answer/citations).
    driveLookup.mockResolvedValueOnce({ docs: [] });
    const { runQuery } = await import("./graph.js");
    const r = await runQuery("c1", "apa isi surat dinas nomor 999", [], true);
    expect(driveLookup).toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    // Indonesian question -> Indonesian refusal, and no sources.
    expect(r.answer).toMatch(/tidak menemukan/i);
    expect(r.sources).toEqual([]);
    // Still titled on the first message.
    expect(r.title).toBe("T");
  });

  it("does not refuse when a file is attached, even with empty context", async () => {
    // hasAttachments routes through retrieve; an empty drive result must still
    // reach generate (the upload itself is the context), never noMatch.
    intent.mockResolvedValueOnce({ useDrive: true, needsWeb: false, needsReasoning: false, hasAttachments: true });
    grade.mockResolvedValueOnce({ relevant: false });
    driveLookup.mockResolvedValueOnce({ docs: [] });
    const { runQuery } = await import("./graph.js");
    const r = await runQuery("c1", "jelaskan gambar ini", [], false);
    expect(generate).toHaveBeenCalled();
    expect(r.answer).toBe("from-docs");
  });

  it("threads needsReasoning through to the generate node", async () => {
    intent.mockResolvedValueOnce({ useDrive: false, needsWeb: false, needsReasoning: true, hasAttachments: false });
    const { runQuery } = await import("./graph.js");
    await runQuery("c1", "mana yang lebih baik, A atau B", [], false);
    expect(generate).toHaveBeenCalled();
    const state = (generate.mock.calls[0] as unknown[])[0] as { needsReasoning?: boolean };
    expect(state.needsReasoning).toBe(true);
  });

  it("public question routes straight to web search, skipping retrieve", async () => {
    intent.mockResolvedValueOnce({ useDrive: false, needsWeb: true, needsReasoning: false, hasAttachments: false });
    const { runQuery } = await import("./graph.js");
    const r = await runQuery("c1", "apa itu css", [], false);
    expect(retrieve).not.toHaveBeenCalled();
    expect(webSearch).toHaveBeenCalled();
    expect(r.answer).toBe("from-docs");
  });

  it("creative task generates directly, skipping retrieve and web search", async () => {
    intent.mockResolvedValueOnce({ useDrive: false, needsWeb: false, needsReasoning: false, hasAttachments: false });
    const { runQuery } = await import("./graph.js");
    const r = await runQuery("c1", "buatkan flowchart", [], false);
    expect(retrieve).not.toHaveBeenCalled();
    expect(webSearch).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalled();
    expect(r.answer).toBe("from-docs");
  });
});
