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
  return String(res.content).toLowerCase().includes("yes");
}
