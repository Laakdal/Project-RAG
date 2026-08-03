// backend/src/rag/attachment-reader.ts
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { attachments } from "../db/schema.js";
import { readFile } from "./n8n-client.js";
import { config } from "../config.js";
import { extractPdfHybrid } from "./pdf-extract.js";
import { embedAttachment } from "./attachment-vectors.js";

function isPdf(filename: string, mimeType: string | null): boolean {
  return (mimeType ?? "").toLowerCase() === "application/pdf" || filename.toLowerCase().endsWith(".pdf");
}

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function markFailed(id: string): Promise<void> {
  await db.update(attachments).set({ status: "failed" }).where(eq(attachments.id, id));
}

// Read the file via n8n and cache the Markdown; flips status to ready/failed.
// Used as both the background job and the query-time self-heal.
export async function runRead(attachmentId: string): Promise<void> {
  const rows = await db
    .select({
      conversationId: attachments.conversationId,
      filename: attachments.filename,
      mimeType: attachments.mimeType,
      data: attachments.data,
    })
    .from(attachments)
    .where(eq(attachments.id, attachmentId))
    .limit(1);
  const row = rows[0];
  if (!row || !row.data) { await markFailed(attachmentId); return; }
  try {
    // PDFs go through the local-first hybrid extractor (pdftotext for text pages,
    // per-page Gemini OCR only for image pages). It returns null when the local
    // pipeline can't run (encrypted/corrupt, or poppler missing) — then, and for
    // every non-PDF, fall back to the whole-file rag-read path so nothing regresses.
    let text: string | null = null;
    if (config.LOCAL_PDF_EXTRACT && isPdf(row.filename, row.mimeType)) {
      text = await extractPdfHybrid(row.data);
    }
    if (text === null) {
      ({ text } = await readFile(row.filename, row.data, row.mimeType ?? "application/octet-stream"));
    }
    if (!text || !text.trim()) { await markFailed(attachmentId); return; }
    // Chunk + embed for per-chat retrieval (RAG) so a large doc can be answered
    // from relevant chunks instead of the whole text. Best-effort: an embedding
    // failure must not fail the read — short docs still answer whole-doc-in-context.
    try {
      await embedAttachment(row.conversationId, attachmentId, row.filename, text);
    } catch (err) {
      console.error("[attachment-reader] embed failed for", attachmentId, err);
    }
    await db.update(attachments).set({ extractedText: text, status: "ready" }).where(eq(attachments.id, attachmentId));
  } catch (err) {
    console.error("[attachment-reader] read failed for", attachmentId, err);
    await markFailed(attachmentId);
  }
}

// Fire-and-forget; never throws into the request handler.
export function startBackgroundRead(attachmentId: string): void {
  void runRead(attachmentId).catch((err) => console.error("[attachment-reader] background read crashed for", attachmentId, err));
}

// Return the cached Markdown, waiting for a background read, self-healing a stuck
// one. Returns null if the file could not be read.
export async function ensureExtractedText(attachmentId: string): Promise<string | null> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const rows = await db
      .select({ status: attachments.status, extractedText: attachments.extractedText })
      .from(attachments)
      .where(eq(attachments.id, attachmentId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.status === "ready") return row.extractedText ?? null;
    if (row.status === "failed") return null;
    await sleep(POLL_INTERVAL_MS);
  }
  await runRead(attachmentId); // self-heal a lost/stuck background read
  const rows = await db
    .select({ status: attachments.status, extractedText: attachments.extractedText })
    .from(attachments)
    .where(eq(attachments.id, attachmentId))
    .limit(1);
  return rows[0]?.status === "ready" ? rows[0].extractedText ?? null : null;
}
