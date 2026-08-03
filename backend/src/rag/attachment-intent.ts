// backend/src/rag/attachment-intent.ts
//
// Does the question point AT the file the user attached?
//
// The per-chat relevance gate scores the question against the attachment's text
// and drops the attachment when the score is low. That works for prose, but a
// diagram, screenshot, spreadsheet or code file extracts to keyword-dense text
// with no sentences, so even a bang-on question ("entitas apa saja di ERD ini?")
// scores ~0.2 against it — under any threshold tuned for documents. The file
// then loses to the shared library and the user gets a confident answer about
// something else entirely.
//
// A demonstrative reference is a far stronger signal than cosine similarity:
// "apa isi file ini" IS the user pointing at the attachment. When that shows up,
// scope to the attachment and skip the score check.
const ATTACHMENT_REFERENCES: RegExp[] = [
  // Indonesian: "file ini", "dokumen tersebut", "gambar itu", …
  /\b(file|dokumen|berkas|gambar|foto|diagram|grafik|tabel|pdf|excel|screenshot|lampiran)\s+(ini|itu|tsb|tersebut)\b/i,
  // Indonesian: "apa isi file", "isi dokumen" (no demonstrative needed).
  /\bisi\s+(dari\s+)?(file|dokumen|berkas)\b/i,
  // Indonesian: "yang saya lampirkan", "yg saya kirim", "saya upload".
  /\b(yang|yg)\s+(saya|aku)\s+(lampirkan|kirim|kirimkan|upload|unggah)\b/i,
  /\b(saya|aku)\s+(lampirkan|melampirkan|upload|unggah)\b/i,
  /\blampiran\b/i,
  // English: "this file", "that document", "this screenshot", …
  /\b(this|that|the)\s+(file|document|doc|image|picture|photo|diagram|chart|table|pdf|spreadsheet|screenshot)\b/i,
  /\bthe\s+(attached|uploaded)\b/i,
  /\battach(ed|ment)\b/i,
  /\bi\s+(just\s+)?(attached|uploaded|sent)\b/i,
];

/** True when the question refers to an attached file rather than a topic. */
export function refersToAttachment(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  return ATTACHMENT_REFERENCES.some((re) => re.test(q));
}

/**
 * True when a file was attached to THIS question — uploaded after the last turn
 * in the conversation (or in a conversation with no turns yet). Someone who
 * uploads a file and immediately asks something means that file, whatever the
 * similarity score says.
 */
export function attachedForThisTurn(
  attachmentTimes: (Date | string | null | undefined)[],
  lastTurnAt: Date | string | null | undefined,
): boolean {
  const times = attachmentTimes
    .map((t) => (t ? new Date(t).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  if (times.length === 0) return false;
  // No prior turn: the attachment can only belong to the question being asked.
  if (!lastTurnAt) return true;
  const lastTurn = new Date(lastTurnAt).getTime();
  if (!Number.isFinite(lastTurn)) return true;
  return times.some((t) => t > lastTurn);
}
