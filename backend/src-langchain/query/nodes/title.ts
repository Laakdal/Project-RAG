import { makeChatModel } from "../../shared/models.js";

export async function title(state: {
  question: string;
  generateTitle: boolean;
}): Promise<{ title?: string }> {
  if (!state.generateTitle) return {};
  try {
    const res = await makeChatModel().invoke([
      { role: "system", content: "Summarize the user's question as a title of at most 6 words. Return only the title." },
      { role: "user", content: state.question },
    ]);
    const text = (typeof res.content === "string" ? res.content : "").trim();
    return text ? { title: text } : {};
  } catch {
    return {};
  }
}
