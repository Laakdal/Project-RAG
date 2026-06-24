/** Deterministic, dependency-free fallback title from the first user message. */
export function titleFromQuestion(question: string): string {
  const q = (question ?? "").trim();
  if (!q) return "New chat";
  const firstSentence = q.split(/(?<=[.?!])\s/)[0].trim() || q;
  const cleaned = firstSentence.replace(/[.?!]+$/, "").trim();
  return cleaned.length > 60 ? cleaned.slice(0, 57).trimEnd() + "…" : cleaned;
}
