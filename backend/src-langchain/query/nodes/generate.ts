import { makeChatModel } from "../../shared/models.js";
import type { QuerySource } from "../../../src/rag/types.js";

export async function generate(state: {
  question: string;
  docs: QuerySource[];
}): Promise<{ answer: string; sources: QuerySource[] }> {
  const context = state.docs.map((d, i) => `[${i + 1}] ${d.text}`).join("\n\n");
  const res = await makeChatModel().invoke([
    {
      role: "system",
      content: "Answer the question using only the provided context. Be concise.",
    },
    { role: "user", content: `Context:\n${context}\n\nQuestion: ${state.question}` },
  ]);
  const answer = typeof res.content === "string" ? res.content : "";
  return { answer, sources: state.docs };
}
