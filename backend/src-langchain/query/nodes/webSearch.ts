import { makeChatModel } from "../../shared/models.js";
import type { QuerySource } from "../../../src/rag/types.js";

export async function webSearch(state: {
  question: string;
  rewritten?: string;
}): Promise<{ answer: string; sources: QuerySource[] }> {
  const query = state.rewritten || state.question;
  const res = await makeChatModel({ webSearch: true }).invoke([
    { role: "user", content: query },
  ]);
  const answer = typeof res.content === "string" ? res.content : "";
  return { answer, sources: [] };
}
