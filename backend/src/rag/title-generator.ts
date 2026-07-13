import { ChatOpenAI } from "@langchain/openai";
import { config } from "../config.js";

const TITLE_SYSTEM =
  "You write a very short chat title (3 to 6 words) that captures what the conversation is " +
  "about, like the auto-titles in ChatGPT or Gemini. Use the same language as the user. Reply " +
  "with ONLY the title — no surrounding quotes, no trailing punctuation, no prefixes like 'Title:'.";

// LLM-generated conversation title from the first message (and the answer, for
// context). Returns null on any failure or when no API key is set, so the caller
// falls back to the deterministic heuristic — a title is never allowed to block
// or break the response.
export async function summarizeTitle(question: string, answer?: string): Promise<string | null> {
  if (!config.OPENAI_API_KEY) return null;
  const model = new ChatOpenAI({
    apiKey: config.OPENAI_API_KEY,
    model: config.GENERATE_MODEL,
    temperature: 0.2,
  });
  const user = answer
    ? `User's first message:\n${question}\n\nAssistant's answer (context only):\n${answer.slice(0, 800)}`
    : question;
  try {
    const res = await model.invoke([
      { role: "system", content: TITLE_SYSTEM },
      { role: "user", content: user },
    ]);
    const title = String(res.content)
      .trim()
      .replace(/^["'“”]+|["'“”]+$/g, "")
      .replace(/[.?!]+$/, "")
      .trim();
    if (title.length < 2) return null;
    return title.length > 70 ? `${title.slice(0, 67).trimEnd()}…` : title;
  } catch {
    return null;
  }
}

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
