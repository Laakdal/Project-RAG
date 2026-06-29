/** Deterministic, dependency-free fallback title from the first user message. */
export function titleFromQuestion(question: string): string {
  const q = (question ?? "").trim();
  if (!q) return "New chat";
  // Strip a leading list/enumeration marker ("1.", "2)", "- ", "* ", "•") first,
  // so a numbered prompt like "1. User opens the login page..." isn't titled just
  // "1" when we take the first sentence.
  const stripped = q.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim() || q;
  const firstSentence = stripped.split(/(?<=[.?!])\s/)[0].trim();
  // If the first "sentence" is too short to be a useful title (e.g. another bare
  // list number), fall back to the stripped text instead.
  const base = firstSentence.length >= 12 ? firstSentence : stripped;
  const cleaned = base.replace(/[.?!]+$/, "").trim();
  return cleaned.length > 60 ? cleaned.slice(0, 57).trimEnd() + "…" : cleaned;
}
