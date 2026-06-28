import { makeChatModel } from "../../shared/models.js";
import type { QuerySource } from "../../../src/rag/types.js";

export async function grade(state: {
  question: string;
  docs: QuerySource[];
}): Promise<{ relevant: boolean }> {
  if (!state.docs?.length) return { relevant: false };
  try {
    const context = state.docs.map((d) => d.text).join("\n---\n");
    const res = await makeChatModel().invoke([
      {
        role: "system",
        content:
          "Do the provided document chunks contain enough information to answer the question? Reply with exactly 'yes' or 'no'.",
      },
      { role: "user", content: `Question: ${state.question}\n\nChunks:\n${context}` },
    ]);
    const text = (typeof res.content === "string" ? res.content : "").toLowerCase();
    return { relevant: text.includes("yes") };
  } catch {
    return { relevant: false };
  }
}
