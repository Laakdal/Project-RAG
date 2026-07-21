import { makeChatModel } from "../../shared/models.js";
import { extractText } from "../../shared/content.js";
import { logNodeError } from "../../shared/log.js";

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
    const text = extractText(res.content).trim();
    return text ? { title: text } : {};
  } catch (error) {
    logNodeError("title", error);
    return {};
  }
}
