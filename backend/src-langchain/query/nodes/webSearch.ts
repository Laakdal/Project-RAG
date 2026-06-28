import { makeChatModel } from "../../shared/models.js";
import type { QuerySource } from "../../../src/rag/types.js";

export async function webSearch(state: {
  question: string;
}): Promise<{ answer: string; sources: QuerySource[] }> {
  const res = await makeChatModel({ webSearch: true }).invoke([
    { role: "user", content: state.question },
  ]);
  const answer = typeof res.content === "string" ? res.content : "";
  return { answer, sources: [] };
}
