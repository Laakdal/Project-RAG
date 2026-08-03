// backend/src/rag/pdf-extract.ts
//
// Hybrid, local-first PDF text extraction. Instead of shipping a whole document
// to a single Gemini call (slow, and bounded by a 120s timeout that a large book
// blows straight through), this:
//   1. pulls the text layer locally with `pdftotext` — fast, no LLM, no network;
//   2. OCRs ONLY the pages that have little/no text (scanned/image pages) via the
//      existing rag-read Gemini path, one page per call, in bounded parallel.
// A text PDF (the common case) costs zero LLM calls and finishes in seconds; a
// scanned/mixed PDF gets parallel per-page OCR where each call is small and can't
// hit the whole-doc timeout. Requires `poppler-utils` in the runtime image.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile as fsReadFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../config.js";
import { readFile as ocrRead } from "./n8n-client.js";

const execFileAsync = promisify(execFile);

// The poppler tools are fast; this only guards against a wedged binary.
const POPPLER_TIMEOUT_MS = 60_000;
// pdftotext separates pages with a form-feed (0x0C).
const FORM_FEED = "\f";

async function pageCount(pdfPath: string): Promise<number> {
  const { stdout } = await execFileAsync("pdfinfo", [pdfPath], { timeout: POPPLER_TIMEOUT_MS });
  const match = stdout.match(/^Pages:\s+(\d+)/m);
  return match ? Number.parseInt(match[1], 10) : 0;
}

// Render one page to a PNG and OCR it via the existing rag-read (Gemini) path.
// Returns the page's text, or "" when rendering/OCR yields nothing.
async function ocrPage(pdfPath: string, dir: string, pageNum: number): Promise<string> {
  const outPrefix = join(dir, `page-${pageNum}`);
  // -singlefile renders exactly page `pageNum` to `${outPrefix}.png` (no page-
  // number suffix), so the output path is predictable.
  await execFileAsync(
    "pdftoppm",
    ["-png", "-r", String(config.PDF_RENDER_DPI), "-f", String(pageNum), "-l", String(pageNum), "-singlefile", pdfPath, outPrefix],
    { timeout: POPPLER_TIMEOUT_MS },
  );
  const pngPath = `${outPrefix}.png`;
  const png = await fsReadFile(pngPath);
  await rm(pngPath, { force: true }); // free the image before the (slow) OCR call
  const { text } = await ocrRead(`page-${pageNum}.png`, png, "image/png");
  return text?.trim() ? text : "";
}

// Run async tasks with a concurrency cap; preserves input order in the result.
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      await fn(items[next++]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// Extract text from a PDF buffer. Returns the merged text, or `null` when the
// local pipeline can't run at all (encrypted/corrupt PDF, or poppler missing) so
// the caller can fall back to a whole-file read and nothing regresses.
export async function extractPdfHybrid(buffer: Buffer): Promise<string | null> {
  const dir = await mkdtemp(join(tmpdir(), "pdfx-"));
  const pdfPath = join(dir, "in.pdf");
  try {
    await writeFile(pdfPath, buffer);

    let pages: number;
    let raw: string;
    try {
      pages = await pageCount(pdfPath);
      const txtPath = join(dir, "out.txt");
      // -layout keeps columns roughly intact; write to a file (not stdout) to
      // avoid the execFile maxBuffer limit on a large book.
      await execFileAsync("pdftotext", ["-layout", pdfPath, txtPath], { timeout: POPPLER_TIMEOUT_MS });
      raw = await fsReadFile(txtPath, "utf8");
    } catch (err) {
      console.error("[pdf-extract] local text extraction failed; falling back to whole-file read", err);
      return null;
    }

    if (pages <= 0) return null;

    // Split into pages on pdftotext's form-feed, capped to the real page count
    // (a trailing form-feed can add a phantom empty segment).
    const perPage = raw.split(FORM_FEED).slice(0, pages);
    while (perPage.length < pages) perPage.push("");

    const imagePages: number[] = [];
    for (let i = 0; i < pages; i++) {
      if ((perPage[i] ?? "").trim().length < config.PDF_TEXT_MIN_CHARS) imagePages.push(i);
    }

    // Pure-text (or mostly-text) PDF: no OCR needed — this is the fast path.
    if (imagePages.length === 0) return perPage.join("\n\n").trim();

    // OCR the image pages in bounded parallel; a per-page failure just leaves
    // that page blank rather than failing the whole document.
    await mapLimit(imagePages, config.OCR_PAGE_CONCURRENCY, async (pageIdx) => {
      try {
        perPage[pageIdx] = await ocrPage(pdfPath, dir, pageIdx + 1);
      } catch (err) {
        console.error("[pdf-extract] OCR failed for page", pageIdx + 1, err);
        perPage[pageIdx] = "";
      }
    });

    return perPage.join("\n\n").trim();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
