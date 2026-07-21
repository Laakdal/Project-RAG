import { searchFiles, downloadFile } from "../../library/drive.js";
import { geminiRead } from "../../shared/models.js";
import { listDriveSources } from "../../../src/settings/drive-sources.js";
import { logNodeError } from "../../shared/log.js";
import type { QuerySource } from "../../../src/rag/types.js";

// Light keyword extraction (EN + ID stopwords) — good enough to build a Drive
// full-text query from the question. Mirrors the heuristic fallback in the n8n
// Drive Lookup subflow.
const STOP = new Set([
  "the", "a", "an", "of", "in", "on", "for", "to", "and", "or", "is", "are", "what",
  "which", "how", "my", "me", "you", "this", "that", "file", "files", "drive", "about",
  "please", "explain", "give", "tell", "show", "find", "from", "with", "it", "its",
  "document", "documents", "apa", "apakah", "yang", "dari", "dan", "atau", "untuk",
  "dengan", "pada", "adalah", "saya", "ini", "itu", "dalam", "tentang", "mengenai",
  "isi", "jelaskan", "tolong", "berapa", "siapa", "kapan", "dimana",
]);

function terms(q: string): string[] {
  const words = (q.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOP.has(w));
  return [...new Set(words)].slice(0, 8);
}

// On-demand Drive lookup: reached when the intent is a document question but the
// pre-indexed library / per-chat retrieval found nothing relevant. Searches live
// Drive across EVERY configured Drive source (each its own Google account), reads
// the top match from each with Gemini, and hands them to generate as context.
// Dormant (returns no docs) until at least one Drive source is configured.
export async function driveLookup(state: {
  question: string;
  rewritten?: string;
}): Promise<{ docs: QuerySource[] }> {
  const sources = listDriveSources();
  if (!sources.length) return { docs: [] };
  const kw = terms(state.rewritten ?? state.question);
  if (!kw.length) return { docs: [] };
  const esc = (s: string) => s.replace(/'/g, "\\'");
  const clauses = kw.map((w) => `fullText contains '${esc(w)}' or name contains '${esc(w)}'`).join(" or ");
  const q = `trashed = false and (${clauses})`;

  const docs: QuerySource[] = [];
  for (const src of sources) {
    if (!src.refreshToken) continue; // not signed in yet
    const creds = { clientId: src.clientId, clientSecret: src.clientSecret, refreshToken: src.refreshToken };
    // Best-effort per source: one bad account never blocks the others.
    try {
      const files = await searchFiles(creds, q, 3);
      if (!files.length) continue;
      const top = files[0];
      const { buffer, mimeType } = await downloadFile(creds, top);
      const text = await geminiRead(buffer, mimeType);
      if (text) docs.push({ filename: top.name, chunkIndex: 0, text, webUrl: top.webUrl });
    } catch (error) {
      // Skip this source; one bad account never blocks the others.
      logNodeError(`driveLookup (${src.name})`, error);
    }
  }
  return { docs };
}
