// backend/src/rag/pdf-locate.ts
//
// Find which page of a PDF a retrieved chunk came from, so the UI can open the
// preview at that page when the user clicks its [n] citation badge.
//
// We don't store a page number on the chunk: chunking runs on the merged text
// (see attachment-vectors.ts) long after the page boundaries are gone. But the
// chunk text IS, verbatim, a slice of `pdftotext -layout` output, so re-running
// pdftotext on the stored file and searching its per-page segments recovers the
// page exactly — no heuristics, and it works for documents uploaded before this
// existed. Pages that were OCR'd instead (no text layer) simply don't match, and
// the caller falls back to page 1.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile as fsReadFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

const POPPLER_TIMEOUT_MS = 60_000;
// pdftotext separates pages with a form-feed (0x0C).
const FORM_FEED = "\f";
// Prefix lengths to try, longest first: long enough to be unique in a document,
// but a chunk that starts just before a page break has even its opening split
// across two pages, so fall back to shorter prefixes before giving up.
const SNIPPET_CHARS = [120, 60, 30];
// A snippet shorter than this matches too loosely to trust.
const MIN_SNIPPET_CHARS = 12;
// Extracted page text for the last few previewed documents. A big book costs a
// second or two of pdftotext, and a reader clicks several badges on the same
// file, so keep a handful in memory rather than re-extracting each time.
const CACHE_MAX = 4;

const cache = new Map<string, string[]>();

/**
 * Collapse all runs of whitespace and lowercase, so `-layout` column padding
 * and line wrapping don't defeat an otherwise exact match.
 */
export function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Split a PDF into its per-page text using pdftotext. */
export async function pdfPageTexts(buffer: Buffer): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), "pdfloc-"));
  const pdfPath = join(dir, "in.pdf");
  const txtPath = join(dir, "out.txt");
  try {
    await writeFile(pdfPath, buffer);
    // Same flags as the extraction path, so the text we search is the text the
    // chunks were cut from.
    await execFileAsync("pdftotext", ["-layout", pdfPath, txtPath], {
      timeout: POPPLER_TIMEOUT_MS,
    });
    const raw = await fsReadFile(txtPath, "utf8");
    return raw.split(FORM_FEED);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * 1-based page number whose text contains the start of `chunk`, or null when
 * nothing matches (an OCR'd page, or a chunk from a non-PDF document).
 */
export function findPage(pageTexts: string[], chunk: string): number | null {
  const opening = normalize(chunk);
  if (opening.length < MIN_SNIPPET_CHARS) return null;
  // Normalize each page once, not once per prefix length.
  const pages = pageTexts.map(normalize);
  for (const length of SNIPPET_CHARS) {
    const needle = opening.slice(0, length);
    if (needle.length < MIN_SNIPPET_CHARS) continue;
    for (let i = 0; i < pages.length; i++) {
      if (pages[i].includes(needle)) return i + 1;
    }
  }
  return null;
}

/**
 * Page of `chunk` within the PDF `buffer`, caching the extracted page text
 * under `cacheKey` (the attachment id) for repeat clicks on the same document.
 */
export async function locateChunkPage(
  cacheKey: string,
  buffer: Buffer,
  chunk: string,
): Promise<number | null> {
  let pageTexts = cache.get(cacheKey);
  if (!pageTexts) {
    pageTexts = await pdfPageTexts(buffer);
    // Evict oldest first (Map preserves insertion order).
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(cacheKey, pageTexts);
  }
  return findPage(pageTexts, chunk);
}

/** Test seam: drop cached page text (also used when an attachment is deleted). */
export function clearLocateCache(): void {
  cache.clear();
}
