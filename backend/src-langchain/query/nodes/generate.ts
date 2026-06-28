import { makeChatModel } from "../../shared/models.js";
import { extractText } from "../../shared/content.js";
import type { QuerySource } from "../../../src/rag/types.js";

export const FALLBACK_ANSWER =
  "Sorry — I couldn't generate an answer right now. Please try again.";

export async function generate(state: {
  question: string;
  docs: QuerySource[];
}): Promise<{ answer: string; sources: QuerySource[] }> {
  try {
    const context = state.docs.map((d, i) => `[${i + 1}] ${d.text}`).join("\n\n");
    const res = await makeChatModel().invoke([
      {
        role: "system",
        content: "Answer the question using only the provided context. Be concise.",
      },
      { role: "user", content: `Context:\n${context}\n\nQuestion: ${state.question}` },
    ]);
    const answer = extractText(res.content);
    return { answer, sources: state.docs };
  } catch {
    return { answer: FALLBACK_ANSWER, sources: [] };
  }
}
