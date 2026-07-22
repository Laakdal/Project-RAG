// backend/src/rag/context-selection.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const retrieveMock = vi.hoisted(() => vi.fn());
vi.mock("./attachment-vectors.js", () => ({ retrieveAttachmentChunks: retrieveMock }));

const searchScoredMock = vi.hoisted(() => vi.fn());
const shouldSearchMock = vi.hoisted(() => vi.fn());
const sufficientMock = vi.hoisted(() => vi.fn());
vi.mock("../library/retrieve.js", () => ({
  searchLibraryScored: searchScoredMock,
  shouldSearchLibrary: shouldSearchMock,
  librarySufficient: sufficientMock,
}));

const { selectContext } = await import("./context-selection.js");

// The measured score for "apa is file ini?" against an ERD screenshot on the
// live system. Well under CHAT_RELEVANCE_THRESHOLD (0.35) — the old fixed gate
// threw the file away and let the shared library answer instead.
const ERD_SCORE = 0.158;

const ERD_HIT = { filename: "erd_lengkap.png", text: "pelanggan id nama pesanan ...", score: ERD_SCORE };
const ERD_DOC = {
  filename: "erd_lengkap.png",
  extractedText: "pelanggan id nama pesanan ...",
  createdAt: new Date("2026-07-22T03:20:00Z"),
};
const LAST_TURN = new Date("2026-07-22T03:25:00Z"); // AFTER the upload: not "just attached"

const LIBRARY_HIT = {
  docs: [{ filename: "DTIS_PPAB_130_VIII_2025.pdf", chunkIndex: 0, text: "anggaran ..." }],
  topScore: 0.44,
};

beforeEach(() => {
  retrieveMock.mockReset().mockResolvedValue([ERD_HIT]);
  searchScoredMock.mockReset().mockResolvedValue(LIBRARY_HIT);
  shouldSearchMock.mockReset().mockResolvedValue(true);
  sufficientMock.mockReset().mockResolvedValue(false);
});

const base = {
  conversationId: "c1",
  readyDocs: [ERD_DOC],
  lastTurnAt: LAST_TURN,
};

describe("questions pointing at the attachment", () => {
  it("answers from the attachment despite a score far below the threshold", async () => {
    const out = await selectContext({ ...base, question: "apa is file ini?" });
    expect(out.docs.map((d) => d.filename)).toEqual(["erd_lengkap.png"]);
    expect(out.libraryDocs).toEqual([]);
    // The whole point: the library must not be consulted at all here.
    expect(searchScoredMock).not.toHaveBeenCalled();
  });

  it("answers from the attachment when it was uploaded for this very question", async () => {
    // Score is low and the wording is generic, but the file arrived after the
    // last turn, so it is what the user means.
    const out = await selectContext({
      ...base,
      question: "tolong jelaskan",
      lastTurnAt: new Date("2026-07-22T03:10:00Z"), // BEFORE the upload
    });
    expect(out.docs.map((d) => d.filename)).toEqual(["erd_lengkap.png"]);
    expect(out.libraryDocs).toEqual([]);
  });
});

describe("questions about the shared library", () => {
  it("still falls through to the library for an unrelated question", async () => {
    // No pointer at the file, weak attachment score, strong library score.
    const out = await selectContext({
      ...base,
      question: "siapa yang perjalanan dinas pada 23 Juni 2025?",
    });
    expect(out.docs).toEqual([]);
    expect(out.libraryDocs.map((d) => d.filename)).toEqual(["DTIS_PPAB_130_VIII_2025.pdf"]);
  });

  it("skips the live Drive read only when the library provably answers", async () => {
    sufficientMock.mockResolvedValue(true);
    const out = await selectContext({ ...base, question: "berapa anggaran DTIS PPAB 130?" });
    expect(out.skipDrive).toBe(true);
  });
});

describe("the undecided middle", () => {
  it("keeps the attachment when it outscores the library", async () => {
    searchScoredMock.mockResolvedValue({ docs: LIBRARY_HIT.docs, topScore: 0.1 });
    const out = await selectContext({ ...base, question: "ringkas isinya" });
    expect(out.docs.map((d) => d.filename)).toEqual(["erd_lengkap.png"]);
    expect(out.libraryDocs).toEqual([]);
  });

  it("keeps the attachment when there is no library search to weigh it against", async () => {
    shouldSearchMock.mockResolvedValue(false);
    const out = await selectContext({ ...base, question: "ringkas isinya" });
    expect(out.docs.map((d) => d.filename)).toEqual(["erd_lengkap.png"]);
  });

  it("drops an attachment that is noise for the question", async () => {
    // Below the absolute floor and beaten by the library: genuinely unrelated.
    retrieveMock.mockResolvedValue([{ ...ERD_HIT, score: 0.02 }]);
    const out = await selectContext({ ...base, question: "buatkan flowchart login" });
    expect(out.docs).toEqual([]);
    expect(out.libraryDocs.length).toBe(1);
  });
});

describe("failure handling", () => {
  it("stays scoped to the attachment when scoring itself fails", async () => {
    // A retrieval outage must not silently redirect the question elsewhere.
    retrieveMock.mockRejectedValue(new Error("qdrant down"));
    const out = await selectContext({ ...base, question: "ringkas isinya" });
    expect(out.docs.map((d) => d.filename)).toEqual(["erd_lengkap.png"]);
    expect(searchScoredMock).not.toHaveBeenCalled();
  });

  it("returns empty context when the chat has no attachments and the library errors", async () => {
    searchScoredMock.mockRejectedValue(new Error("boom"));
    const out = await selectContext({ ...base, readyDocs: [], question: "apa itu PalmCo?" });
    expect(out.docs).toEqual([]);
    expect(out.libraryDocs).toEqual([]);
    expect(out.skipDrive).toBe(false);
  });

  it("reports progress for the streaming route", async () => {
    const onStatus = vi.fn();
    await selectContext({ ...base, question: "apa isi file ini?", onStatus });
    expect(onStatus).toHaveBeenCalledWith("Reading your attached file…", "reading");
  });
});
