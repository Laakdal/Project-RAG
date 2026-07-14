// backend/src/rag/pdf-extract.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the poppler subprocess calls. `promisify(execFile)` resolves with the
// object passed to the callback, so each call returns { stdout, stderr }.
const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

// Mock the filesystem so no real temp files are touched. `readFile` is routed by
// path: out.txt returns the pdftotext output, *.png returns a fake image buffer.
const fsReadMock = vi.hoisted(() => vi.fn());
vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn(async (p: string) => `${p}test`),
  writeFile: vi.fn(async () => {}),
  readFile: fsReadMock,
  rm: vi.fn(async () => {}),
}));

// Mock the rag-read OCR path.
const ocrMock = vi.hoisted(() => vi.fn());
vi.mock("./n8n-client.js", () => ({ readFile: ocrMock }));

type Cb = (err: unknown, res?: { stdout: string; stderr: string }) => void;

/** Route execFile by command name; pdfinfo reports `pages`, the rest are no-ops. */
function popplerWithPages(pages: number): void {
  execFileMock.mockImplementation((file: string, _args: string[], _opts: unknown, cb: Cb) => {
    if (file === "pdfinfo") cb(null, { stdout: `Pages: ${pages}\n`, stderr: "" });
    else cb(null, { stdout: "", stderr: "" });
  });
}

beforeEach(() => {
  execFileMock.mockReset();
  fsReadMock.mockReset();
  ocrMock.mockReset();
});

describe("extractPdfHybrid", () => {
  it("extracts a text PDF locally with no OCR calls", async () => {
    popplerWithPages(2);
    const p1 = "This is the first page with plenty of extractable text.";
    const p2 = "This is the second page, also full of real text content.";
    fsReadMock.mockImplementation(async (path: string) =>
      String(path).endsWith("out.txt") ? `${p1}\f${p2}` : Buffer.from(""),
    );

    const { extractPdfHybrid } = await import("./pdf-extract.js");
    const out = await extractPdfHybrid(Buffer.from("%PDF-1.4"));

    expect(out).toContain(p1);
    expect(out).toContain(p2);
    expect(ocrMock).not.toHaveBeenCalled();
  });

  it("OCRs only the image pages of a mixed PDF", async () => {
    popplerWithPages(2);
    const textPage = "A real text page with plenty of characters on it.";
    // Page 1 has text, page 2 is blank (image) → only page 2 is OCR'd.
    fsReadMock.mockImplementation(async (path: string) =>
      String(path).endsWith("out.txt") ? `${textPage}\f` : Buffer.from("PNG"),
    );
    ocrMock.mockResolvedValue({ text: "OCR of the scanned page" });

    const { extractPdfHybrid } = await import("./pdf-extract.js");
    const out = await extractPdfHybrid(Buffer.from("%PDF-1.4"));

    expect(ocrMock).toHaveBeenCalledTimes(1);
    expect(out).toContain(textPage);
    expect(out).toContain("OCR of the scanned page");
  });

  it("returns null when pdftotext/pdfinfo fails, so the caller can fall back", async () => {
    execFileMock.mockImplementation((file: string, _args: string[], _opts: unknown, cb: Cb) => {
      if (file === "pdfinfo") cb(new Error("not a valid PDF"));
      else cb(null, { stdout: "", stderr: "" });
    });
    fsReadMock.mockResolvedValue("");

    const { extractPdfHybrid } = await import("./pdf-extract.js");
    expect(await extractPdfHybrid(Buffer.from("garbage"))).toBeNull();
  });
});
