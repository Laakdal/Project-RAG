import { searchFiles, downloadFile, type DriveFile, type DriveCreds } from "../../library/drive.js";
import { geminiRead, makeTermsModel } from "../../shared/models.js";
import { extractText } from "../../shared/content.js";
import { listDriveSources } from "../../../src/settings/drive-sources.js";
import { getDriveReadCache, upsertDriveReadCache } from "../../../src/settings/drive-cache.js";
import { logNodeError } from "../../shared/log.js";
import type { QuerySource } from "../../../src/rag/types.js";

// A Drive file bigger than this is skipped — reading it is slow and blows the
// reader's token budget. Matches the n8n Pick Files SIZE_CAP.
const SIZE_CAP = 20 * 1024 * 1024;

// Verbatim from the live n8n "Extract Terms" node (Drive Lookup subflow). The
// question is appended after it.
const EXTRACT_TERMS_PROMPT = `You extract Google Drive search keywords from a question about the user's company documents (usually Indonesian). Reply with ONLY a raw JSON object with two fields, both string arrays: phrases and terms.
phrases = 1 to 3 exact multi-word strings likely to appear verbatim in the target file or its filename (a key phrase like perjalanan dinas, a date like 23 juni 2025, or a document type).
terms = 5 to 10 individual important words, INCLUDING every date part, number, and proper name, plus useful synonyms or abbreviations (for example sppd for surat perintah perjalanan dinas). All lowercase, keep the Indonesian words. EXCLUDE filler and generic words such as database, file, dokumen, data.

Question: `;

// Light keyword extraction (EN + ID stopwords) — the fallback when the LLM
// extractor is unavailable or returns nothing. Mirrors the heuristic branch of
// the n8n Build Query node.
const STOP = new Set([
  "the", "a", "an", "of", "in", "on", "for", "to", "and", "or", "is", "are", "what",
  "which", "how", "my", "me", "you", "this", "that", "file", "files", "drive", "about",
  "please", "explain", "give", "tell", "show", "find", "from", "with", "it", "its",
  "document", "documents", "apa", "apakah", "yang", "dari", "dan", "atau", "untuk",
  "dengan", "pada", "adalah", "saya", "ini", "itu", "dalam", "tentang", "mengenai",
  "isi", "jelaskan", "tolong", "berapa", "siapa", "kapan", "dimana",
]);

function heuristicTerms(q: string): string[] {
  const words = (q.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOP.has(w));
  return [...new Set(words)].slice(0, 8);
}

// Prefer the LLM extractor (robust to phrasing, dates, synonyms); fall back to
// the local heuristic only when it fails or returns no terms — exactly the n8n
// order of preference.
async function extractTerms(question: string): Promise<{ phrases: string[]; terms: string[] }> {
  try {
    const res = await makeTermsModel().invoke([{ role: "user", content: EXTRACT_TERMS_PROMPT + question }]);
    const text = extractText(res.content);
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a >= 0 && b > a) {
      const parsed = JSON.parse(text.slice(a, b + 1)) as { phrases?: unknown; terms?: unknown };
      const rawPhrases: unknown[] = Array.isArray(parsed.phrases) ? parsed.phrases : [];
      const rawTerms: unknown[] = Array.isArray(parsed.terms) ? parsed.terms : [];
      const phrases = rawPhrases
        .map((x) => String(x).trim())
        .filter((s) => s.length > 0)
        .slice(0, 3);
      const terms = [
        ...new Set(rawTerms.map((x) => String(x).toLowerCase().trim()).filter((s) => s.length > 0)),
      ].slice(0, 12);
      if (terms.length) return { phrases, terms };
    }
  } catch (error) {
    logNodeError("driveLookup (extractTerms)", error);
  }
  return { phrases: [], terms: heuristicTerms(question) };
}

// Build a Drive `q` from phrases + terms (n8n Build Query, without the PalmCo
// parent-folder scope — dev3 searches each connected account whole).
function buildQuery(phrases: string[], terms: string[]): string {
  const esc = (s: string) => s.replace(/'/g, "\\'");
  const conditions: string[] = [];
  for (const p of phrases) conditions.push(`fullText contains '${esc(p)}'`);
  for (const t of terms) conditions.push(`fullText contains '${esc(t)}' or name contains '${esc(t)}'`);
  return `(${conditions.join(" or ")}) and trashed = false`;
}

// n8n Pick Files: drop over-cap files, score by how many terms appear in the
// filename, tie-break by search order, take the single best. dev3 applies this
// per source (Option 2 — top file from each connected account).
function pickTop(files: DriveFile[], terms: string[]): DriveFile | undefined {
  const scored = files
    .filter((f) => f.id && !(f.size && Number(f.size) > SIZE_CAP))
    .map((f, idx) => {
      const name = f.name.toLowerCase();
      let nameHits = 0;
      for (const t of terms) if (t && name.includes(t)) nameHits++;
      return { f, nameHits, idx };
    });
  scored.sort((x, y) => y.nameHits - x.nameHits || x.idx - y.idx);
  return scored.length ? scored[0].f : undefined;
}

// Read-through cache (n8n Decide Cache / Cache Upsert): a hit needs cached
// Markdown AND a matching modifiedTime, else re-read and upsert.
async function readWithCache(creds: DriveCreds, file: DriveFile): Promise<string> {
  const cached = await getDriveReadCache(file.id);
  if (cached && cached.markdown && cached.modifiedTime === file.modifiedTime) {
    return cached.markdown;
  }
  const { buffer, mimeType } = await downloadFile(creds, file);
  const text = await geminiRead(buffer, mimeType);
  if (text) {
    await upsertDriveReadCache({
      driveFileId: file.id,
      modifiedTime: file.modifiedTime,
      filename: file.name,
      markdown: text,
    });
  }
  return text;
}

// On-demand Drive lookup: reached when the intent is a document question but the
// pre-indexed library / per-chat retrieval found nothing relevant. Extracts
// search terms, searches live Drive across EVERY configured source (each its own
// Google account), reads the top match from each with Gemini (cached), and hands
// them to generate as context. Dormant (returns no docs) until at least one
// Drive source is configured.
export async function driveLookup(state: {
  question: string;
  rewritten?: string;
}): Promise<{ docs: QuerySource[] }> {
  const sources = listDriveSources();
  if (!sources.length) return { docs: [] };
  const { phrases, terms } = await extractTerms(state.question);
  if (!phrases.length && !terms.length) return { docs: [] };
  const q = buildQuery(phrases, terms);

  const docs: QuerySource[] = [];
  for (const src of sources) {
    if (!src.refreshToken) continue; // not signed in yet
    const creds = { clientId: src.clientId, clientSecret: src.clientSecret, refreshToken: src.refreshToken };
    // Best-effort per source: one bad account never blocks the others.
    try {
      const files = await searchFiles(creds, q, 10);
      if (!files.length) continue;
      const top = pickTop(files, terms);
      if (!top) continue;
      const text = await readWithCache(creds, top);
      if (text) docs.push({ filename: top.name, chunkIndex: 0, text, webUrl: top.webUrl });
    } catch (error) {
      // Skip this source; one bad account never blocks the others.
      logNodeError(`driveLookup (${src.name})`, error);
    }
  }
  return { docs };
}
