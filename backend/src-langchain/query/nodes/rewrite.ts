import { makeChatModel } from "../../shared/models.js";
import { extractText } from "../../shared/content.js";
import type { ChatTurn } from "../../../src/rag/types.js";

export async function rewrite(state: {
  question: string;
  history: ChatTurn[];
}): Promise<{ rewritten: string }> {
  if (!state.history?.length) return { rewritten: state.question };
  try {
    const transcript = state.history.map((t) => `${t.role}: ${t.content}`).join("\n");
    const res = await makeChatModel().invoke([
      {
        role: "system",
        content:
          "Rewrite the user's question as a standalone search query using the prior conversation for context. Return only the rewritten query.",
      },
      { role: "user", content: `Conversation:\n${transcript}\n\nQuestion: ${state.question}` },
    ]);
    const text = extractText(res.content);
    return { rewritten: text.trim() || state.question };
  } catch {
    return { rewritten: state.question };
  }
}
