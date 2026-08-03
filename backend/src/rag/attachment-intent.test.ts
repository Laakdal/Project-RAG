// backend/src/rag/attachment-intent.test.ts
import { describe, it, expect } from "vitest";
import { refersToAttachment, attachedForThisTurn } from "./attachment-intent.js";

describe("refersToAttachment", () => {
  it("catches the Indonesian phrasings people actually type", () => {
    // The real question that misfired: an ERD screenshot, answered from the
    // shared library because the score was 0.158.
    expect(refersToAttachment("apa is file ini?")).toBe(true);
    expect(refersToAttachment("apa isi file ini?")).toBe(true);
    expect(refersToAttachment("jelaskan diagram ini")).toBe(true);
    expect(refersToAttachment("tolong ringkas dokumen tersebut")).toBe(true);
    expect(refersToAttachment("gambar itu menunjukkan apa?")).toBe(true);
    expect(refersToAttachment("apa isi dari file yang saya lampirkan")).toBe(true);
    expect(refersToAttachment("saya lampirkan ERD, tolong dijelaskan")).toBe(true);
    expect(refersToAttachment("lihat lampiran")).toBe(true);
  });

  it("catches the English phrasings", () => {
    expect(refersToAttachment("what is this file?")).toBe(true);
    expect(refersToAttachment("summarize this document")).toBe(true);
    expect(refersToAttachment("explain the attached diagram")).toBe(true);
    expect(refersToAttachment("what does the uploaded spreadsheet contain?")).toBe(true);
    expect(refersToAttachment("I just uploaded a screenshot, what is it?")).toBe(true);
  });

  it("does not fire on questions about the shared library", () => {
    // These must keep falling through to the library/Drive search.
    expect(refersToAttachment("siapa yang perjalanan dinas pada 23 Juni 2025?")).toBe(false);
    expect(refersToAttachment("apa itu PalmCo?")).toBe(false);
    expect(refersToAttachment("berapa anggaran DTIS PPAB 130?")).toBe(false);
    expect(refersToAttachment("buatkan flowchart proses login")).toBe(false);
    expect(refersToAttachment("")).toBe(false);
  });
});

describe("attachedForThisTurn", () => {
  const turn = new Date("2026-07-22T03:00:00Z");

  it("is true when the file was uploaded after the last turn", () => {
    expect(attachedForThisTurn([new Date("2026-07-22T03:05:00Z")], turn)).toBe(true);
  });

  it("is true for the first question in a conversation", () => {
    // No prior turn: the attachment can only belong to the question being asked.
    expect(attachedForThisTurn([new Date("2026-07-22T03:05:00Z")], null)).toBe(true);
  });

  it("is false for a file attached earlier in the conversation", () => {
    // An old attachment must not hijack a question about something else.
    expect(attachedForThisTurn([new Date("2026-07-22T02:00:00Z")], turn)).toBe(false);
  });

  it("is true when ANY of several attachments is new", () => {
    expect(
      attachedForThisTurn(
        [new Date("2026-07-22T02:00:00Z"), new Date("2026-07-22T03:05:00Z")],
        turn,
      ),
    ).toBe(true);
  });

  it("handles missing or unparseable timestamps without throwing", () => {
    expect(attachedForThisTurn([], turn)).toBe(false);
    expect(attachedForThisTurn([null, undefined], turn)).toBe(false);
    // ISO strings (as they arrive from the driver) work too.
    expect(attachedForThisTurn(["2026-07-22T03:05:00Z"], "2026-07-22T03:00:00Z")).toBe(true);
  });
});
