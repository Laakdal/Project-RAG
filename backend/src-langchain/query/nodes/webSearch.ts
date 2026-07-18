import { makeChatModel } from "../../shared/models.js";
import { extractText } from "../../shared/content.js";
import type { QuerySource } from "../../../src/rag/types.js";

// Web-search fallback. Reached when retrieval found nothing relevant. Rather
// than answering here, it gathers a web result and hands it to `generate` as a
// labelled context source, so the final reply is ALWAYS produced by the ported
// Generate Answer prompt (glm-4.6). This mirrors prod (n8n), where web search
// feeds context and the Generate Answer node always formats the reply — without
// it, general/creative questions would be answered by a bare gpt-4o-mini call
// that skips the prompt (no Mermaid, no formatting rules, no language rule).
export async function webSearch(state: {
  question: string;
  rewritten?: string;
}): Promise<{ docs: QuerySource[] }> {
  const query = state.rewritten || state.question;
  try {
    const res = await makeChatModel({ webSearch: true }).invoke([
      { role: "user", content: query },
    ]);
    const text = extractText(res.content);
    // Empty result -> no docs; generate then answers from general knowledge
    // (the prompt covers empty context), which is what creative asks like
    // "buatkan flowchart" need.
    return { docs: text ? [{ filename: "Web search", chunkIndex: 0, text }] : [] };
  } catch {
    return { docs: [] };
  }
}
