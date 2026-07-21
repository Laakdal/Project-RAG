// backend/src/rag/pdf-locate.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the poppler subprocess. `promisify(execFile)` resolves with the object
// passed to the callback, so the call returns { stdout, stderr }.
const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

// Mock the filesystem: out.txt returns the canned pdftotext output.
const fsReadMock = vi.hoisted(() => vi.fn());
vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn(async (p: string) => `${p}test`),
  writeFile: vi.fn(async () => {}),
  readFile: fsReadMock,
  rm: vi.fn(async () => {}),
}));

const { findPage, locateChunkPage, clearLocateCache, pdfPageTexts } = await import("./pdf-locate.js");

type Cb = (err: unknown, res?: { stdout: string; stderr: string }) => void;

const PAGE_1 = "BAB I PENDAHULUAN\n1.1 Latar Belakang\nSistem pengajuan restitusi saat ini masih manual.";
const PAGE_2 = "3.2 Monitoring Status\nPanel untuk mengubah status pengajuan dan form upload bukti bayar.";
const PAGE_3 = "Tabel 4.1 Test case pengujian sistem pada halaman ini.";

function popplerReturns(text: string): void {
  execFileMock.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: Cb) => {
    cb(null, { stdout: "", stderr: "" });
  });
  fsReadMock.mockImplementation(async () => text);
}

beforeEach(() => {
  execFileMock.mockReset();
  fsReadMock.mockReset();
  clearLocateCache();
});

describe("findPage", () => {
  const pages = [PAGE_1, PAGE_2, PAGE_3];

  it("returns the 1-based page holding the chunk", () => {
    expect(findPage(pages, PAGE_2)).toBe(2);
    expect(findPage(pages, PAGE_3)).toBe(3);
  });

  it("matches despite -layout column padding and rewrapped lines", () => {
    // The chunk as stored (single-spaced) vs the page as re-extracted (padded).
    const padded = ["Panel   untuk    mengubah\n   status pengajuan dan form upload bukti bayar."];
    expect(findPage(padded, "Panel untuk mengubah status pengajuan dan form upload bukti bayar.")).toBe(1);
  });

  it("places a chunk that straddles a page break on the page it starts", () => {
    // Chunking runs on the merged text, so a chunk can run past a page end.
    const straddling = `${PAGE_2}\n\n${PAGE_3}`;
    expect(findPage(pages, straddling)).toBe(2);
  });

  it("returns null for text that isn't in the document (an OCR'd page)", () => {
    expect(findPage(pages, "Teks hasil OCR yang tidak ada di lapisan teks PDF ini.")).toBeNull();
  });

  it("refuses to match on a snippet too short to be unique", () => {
    expect(findPage(pages, "BAB")).toBeNull();
    expect(findPage(pages, "   ")).toBeNull();
  });
});

describe("pdfPageTexts", () => {
  it("splits pdftotext output on the form feed", async () => {
    popplerReturns(`${PAGE_1}\f${PAGE_2}\f${PAGE_3}`);
    expect(await pdfPageTexts(Buffer.from("%PDF"))).toEqual([PAGE_1, PAGE_2, PAGE_3]);
  });
});

describe("locateChunkPage", () => {
  it("extracts once and serves repeat lookups on the same file from cache", async () => {
    popplerReturns(`${PAGE_1}\f${PAGE_2}\f${PAGE_3}`);
    const buf = Buffer.from("%PDF");

    expect(await locateChunkPage("att-1", buf, PAGE_1)).toBe(1);
    expect(await locateChunkPage("att-1", buf, PAGE_3)).toBe(3);
    // Clicking several badges on one document must not re-run pdftotext.
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it("re-extracts for a different attachment", async () => {
    popplerReturns(`${PAGE_1}\f${PAGE_2}`);
    await locateChunkPage("att-1", Buffer.from("%PDF"), PAGE_1);
    await locateChunkPage("att-2", Buffer.from("%PDF"), PAGE_2);
    expect(execFileMock).toHaveBeenCalledTimes(2);
  });
});
