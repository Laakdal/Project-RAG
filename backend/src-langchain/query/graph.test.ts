import { describe, it, expect, vi, beforeEach } from "vitest";

const rewrite = vi.fn(async (s: { question: string }) => ({ rewritten: s.question }));
vi.mock("./nodes/rewrite.js", () => ({ rewrite }));
type Intent = {
  useDrive: boolean;
  needsWeb: boolean;
  needsReasoning: boolean;
  needsOptions?: boolean;
  hasAttachments: boolean;
};
const intent = vi.fn(
  async (): Promise<Intent> => ({
    useDrive: true,
    needsWeb: false,
    needsReasoning: false,
    hasAttachments: false,
  }),
);
vi.mock("./nodes/intent.js", () => ({ intent }));
// A chunk of a file attached to this chat, as retrieve reports it: included in
// `docs` for generate, and repeated in `chatDocs` so the fallback nodes can be
// stopped from discarding it.
type Doc = { filename: string; chunkIndex: number; text: string };
const CHAT_DOC: Doc = { filename: "upload.pdf", chunkIndex: 0, text: "upload text" };
const retrieve = vi.fn(
  async (): Promise<{ docs: Doc[]; chatDocs: Doc[] }> => ({
    docs: [{ filename: "d", chunkIndex: 0, text: "t" }],
    chatDocs: [],
  }),
);
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

  it("does not refuse when a file is attached but retrieval found nothing", async () => {
    // hasAttachments routes through retrieve; when it genuinely finds nothing and
    // the drive lookup is empty too, generate must still run (the guard refuses
    // only for document questions with NO attachment), never noMatch.
    intent.mockResolvedValueOnce({ useDrive: true, needsWeb: false, needsReasoning: false, hasAttachments: true });
    retrieve.mockResolvedValueOnce({ docs: [], chatDocs: [] });
    grade.mockResolvedValueOnce({ relevant: false });
    driveLookup.mockResolvedValueOnce({ docs: [] });
    const { runQuery } = await import("./graph.js");
    const r = await runQuery("c1", "jelaskan gambar ini", [], false);
    expect(generate).toHaveBeenCalled();
    expect(r.answer).toBe("from-docs");
  });

  it("keeps the attached file's chunks when the Drive lookup comes back empty", async () => {
    // driveLookup returns only what IT found and `docs` is a LastValue channel,
    // so a failed lookup used to erase the upload the user was asking about and
    // generate answered "I can't find your PDF" over empty context.
    intent.mockResolvedValueOnce({ useDrive: true, needsWeb: false, needsReasoning: false, hasAttachments: true });
    retrieve.mockResolvedValueOnce({ docs: [CHAT_DOC], chatDocs: [CHAT_DOC] });
    grade.mockResolvedValueOnce({ relevant: false });
    driveLookup.mockResolvedValueOnce({ docs: [] });
    const { runQuery } = await import("./graph.js");
    await runQuery("c1", "bagaimana cara menambahkan non fungsional yang ada di pdf", [], false);
    const state = (generate.mock.calls[0] as unknown[])[0] as { docs?: { filename: string }[] };
    expect(state.docs?.map((d) => d.filename)).toEqual(["upload.pdf"]);
  });

  it("adds a Drive hit to the attached file's chunks rather than replacing them", async () => {
    intent.mockResolvedValueOnce({ useDrive: true, needsWeb: false, needsReasoning: false, hasAttachments: true });
    retrieve.mockResolvedValueOnce({ docs: [CHAT_DOC], chatDocs: [CHAT_DOC] });
    grade.mockResolvedValueOnce({ relevant: false });
    const { runQuery } = await import("./graph.js");
    await runQuery("c1", "apa isi SOP IT", [], false);
    // The fallback still runs — a chat holding an attachment must not lose access
    // to Drive for the rest of its life.
    expect(driveLookup).toHaveBeenCalled();
    const state = (generate.mock.calls[0] as unknown[])[0] as { docs?: { filename: string }[] };
    expect(state.docs?.map((d) => d.filename)).toEqual(["upload.pdf", "SOP.pdf"]);
  });

  it("keeps the attached file's chunks when falling back to web search", async () => {
    intent.mockResolvedValueOnce({ useDrive: false, needsWeb: true, needsReasoning: false, hasAttachments: true });
    retrieve.mockResolvedValueOnce({ docs: [CHAT_DOC], chatDocs: [CHAT_DOC] });
    grade.mockResolvedValueOnce({ relevant: false });
    const { runQuery } = await import("./graph.js");
    await runQuery("c1", "harga saham Apple hari ini", [], false);
    expect(webSearch).toHaveBeenCalled();
    const state = (generate.mock.calls[0] as unknown[])[0] as { docs?: { filename: string }[] };
    expect(state.docs?.map((d) => d.filename)).toEqual(["upload.pdf", "Web search"]);
  });

  it("threads needsReasoning through to the generate node", async () => {
    intent.mockResolvedValueOnce({ useDrive: false, needsWeb: false, needsReasoning: true, hasAttachments: false });
    const { runQuery } = await import("./graph.js");
    await runQuery("c1", "mana yang lebih baik, A atau B", [], false);
    expect(generate).toHaveBeenCalled();
    const state = (generate.mock.calls[0] as unknown[])[0] as { needsReasoning?: boolean };
    expect(state.needsReasoning).toBe(true);
  });

  it("threads needsOptions through to the generate node", async () => {
    intent.mockResolvedValueOnce({
      useDrive: false,
      needsWeb: false,
      needsReasoning: false,
      needsOptions: true,
      hasAttachments: false,
    });
    const { runQuery } = await import("./graph.js");
    await runQuery("c1", "tolong bantu dengan skripsi saya", [], false);
    expect(generate).toHaveBeenCalled();
    const state = (generate.mock.calls[0] as unknown[])[0] as { needsOptions?: boolean };
    expect(state.needsOptions).toBe(true);
  });

  it("public question routes to web search", async () => {
    intent.mockResolvedValueOnce({ useDrive: false, needsWeb: true, needsReasoning: false, hasAttachments: false });
    const { runQuery } = await import("./graph.js");
    const r = await runQuery("c1", "apa itu css", [], false);
    expect(webSearch).toHaveBeenCalled();
    expect(r.answer).toBe("from-docs");
  });

  it("creative task generates directly, without web search", async () => {
    intent.mockResolvedValueOnce({ useDrive: false, needsWeb: false, needsReasoning: false, hasAttachments: false });
    const { runQuery } = await import("./graph.js");
    const r = await runQuery("c1", "buatkan flowchart", [], false);
    expect(webSearch).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalled();
    expect(r.answer).toBe("from-docs");
  });

  it("runs retrieval speculatively, concurrently with the intent classifier", async () => {
    // Retrieval no longer waits for intent: it runs on every query so its ~2s
    // hides under the classifier's ~3s instead of stacking after it.
    intent.mockResolvedValueOnce({ useDrive: false, needsWeb: false, needsReasoning: false, hasAttachments: false });
    const { runQuery } = await import("./graph.js");
    await runQuery("c1", "buatkan flowchart", [], false);
    expect(retrieve).toHaveBeenCalled();
  });

  it("discards speculative docs when the question is not about documents", async () => {
    // The library chunks retrieval happened to find must NOT reach generate for
    // a creative ask, or the prompt would be tempted to cite them.
    intent.mockResolvedValueOnce({ useDrive: false, needsWeb: false, needsReasoning: false, hasAttachments: false });
    const { runQuery } = await import("./graph.js");
    await runQuery("c1", "buatkan flowchart login", [], false);
    const state = (generate.mock.calls[0] as unknown[])[0] as { docs?: unknown[] };
    expect(state.docs).toEqual([]);
  });

  it("keeps the retrieved docs when the question IS about documents", async () => {
    intent.mockResolvedValueOnce({ useDrive: true, needsWeb: false, needsReasoning: false, hasAttachments: false });
    grade.mockResolvedValueOnce({ relevant: true });
    const { runQuery } = await import("./graph.js");
    await runQuery("c1", "apa isi SOP IT", [], false);
    const state = (generate.mock.calls[0] as unknown[])[0] as { docs?: unknown[] };
    expect(state.docs).toHaveLength(1);
  });
});
