import type { QuerySource } from "../../../src/rag/types.js";

// Ported verbatim from the live n8n "No Match" node. Reached by the Grounded?
// guard when the user asked about their own documents (useDrive) but no file is
// attached and every retrieval path came back empty. Rather than let the LLM
// fabricate an answer with invented citations, we hard-refuse WITHOUT calling
// the answer model — the whole point of the guard.
//
// The refusal is language-aware: if the question looks Indonesian (any of the
// markers below appears as a whole word) it answers in Indonesian, else English.
// This mirrors the n8n code exactly, including the marker list.
const ID_MARKERS = [
  "apa", "apakah", "siapa", "berapa", "kapan", "mengapa", "kenapa", "bagaimana",
  "yang", "dari", "dengan", "untuk", "pada", "dalam", "berdasarkan", "bedasarkan",
  "tolong", "jelaskan", "dinas", "dokumen", "saya", "ini", "itu", "dan", "atau",
];

const ID_MESSAGE =
  "Maaf, saya tidak menemukan file atau data yang cocok di Google Drive Anda untuk menjawab pertanyaan ini. Coba periksa nama filenya, pastikan file tersebut ada di folder yang terhubung, atau lampirkan filenya langsung ke chat ini agar saya bisa membacanya (termasuk PDF hasil scan/gambar).";

const EN_MESSAGE =
  "I couldn't find a matching file or data in your Google Drive to answer this. Please check the file name, make sure it is in the connected folder, or attach the file directly to this chat so I can read it (including scanned/image PDFs).";

export function noMatch(state: {
  question: string;
}): { answer: string; sources: QuerySource[] } {
  const q = String(state.question ?? "").toLowerCase();
  const isID = ID_MARKERS.some((w) => new RegExp(`\\b${w}\\b`).test(q));
  return { answer: isID ? ID_MESSAGE : EN_MESSAGE, sources: [] };
}
