import { ChatOpenAI } from "@langchain/openai";
import { search } from "./vector-store.js";
import { config } from "../config.js";
import type { QuerySource } from "../rag/types.js";

// Hits below this cosine score are noise for our corpus; tune against real docs.
export const LIBRARY_SCORE_THRESHOLD = 0.2;

export async function searchLibrary(question: string, k = 8): Promise<QuerySource[]> {
  const hits = await search(question, k);
  return hits
    .filter((h) => h.score >= LIBRARY_SCORE_THRESHOLD)
    .map((h) => ({ filename: h.filename, chunkIndex: h.chunkIndex, text: h.text }));
}

const SUFFICIENCY_SYSTEM =
  "You judge whether retrieved document excerpts are enough to answer a user's question " +
  "SPECIFICALLY and correctly. Reply with only 'yes' or 'no'. Answer 'yes' ONLY if the " +
  "excerpts directly contain the information the question asks for. Answer 'no' if they are " +
  "empty, off-topic, or about a related but DIFFERENT document, entity, or date than the one " +
  "asked about — a plausible-looking but wrong document must be 'no'. When unsure, answer 'no'.";

// Does the library context already answer the question well enough to skip the
// slow on-demand live Drive read? Similarity score alone can't tell "right doc"
// from "confidently wrong doc" (both score ~0.5 on our corpus), so this asks a
// cheap model to judge actual answerability. Defaults to false (keep the live
// read) on any doubt, missing key, or error — never trades answer quality for speed.
export async function librarySufficient(
  question: string,
  docs: QuerySource[],
): Promise<boolean> {
  if (!config.OPENAI_API_KEY || docs.length === 0) return false;
  const context = docs
    .map((d, i) => `[${i + 1}] (${d.filename})\n${(d.text || "").slice(0, 1500)}`)
    .join("\n\n");
  const model = new ChatOpenAI({
    apiKey: config.OPENAI_API_KEY,
    model: config.GENERATE_MODEL,
    temperature: 0,
  });
  const res = await model.invoke([
    { role: "system", content: SUFFICIENCY_SYSTEM },
    { role: "user", content: `QUESTION:\n${question}\n\nEXCERPTS:\n${context}` },
  ]);
  return /^\s*yes\b/i.test(String(res.content));
}

const INTENT_SYSTEM =
  "You decide whether a user's message is asking about the content of a document " +
  "in a shared knowledge library. Reply with only 'yes' or 'no'. Answer 'yes' for " +
  "questions about documents, files, reports, SOPs, manuals, policies, or a " +
  "specifically named material. Answer 'no' for generic, creative, or " +
  "general-knowledge requests and small talk.";

export async function shouldSearchLibrary(question: string): Promise<boolean> {
  if (!config.OPENAI_API_KEY) return false;
  const model = new ChatOpenAI({
    apiKey: config.OPENAI_API_KEY,
    model: config.GENERATE_MODEL,
    temperature: 0,
  });
  const res = await model.invoke([
    { role: "system", content: INTENT_SYSTEM },
    { role: "user", content: question },
  ]);
  return /^\s*yes\b/i.test(String(res.content));
}
