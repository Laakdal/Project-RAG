import { makeChatModel } from "../../shared/models.js";
import { extractText } from "../../shared/content.js";
import { generate, FALLBACK_ANSWER } from "./generate.js";
import type { QuerySource } from "../../../src/rag/types.js";

export async function webSearch(state: {
  question: string;
  rewritten?: string;
  docs?: QuerySource[];
}): Promise<{ answer: string; sources: QuerySource[] }> {
  const query = state.rewritten || state.question;
  try {
    const res = await makeChatModel({ webSearch: true }).invoke([
      { role: "user", content: query },
    ]);
    const answer = extractText(res.content);
    return { answer, sources: [] };
  } catch {
    if (state.docs && state.docs.length > 0) {
      return generate({ question: state.question, docs: state.docs });
    }
    return { answer: FALLBACK_ANSWER, sources: [] };
  }
}
