import { makeChatModel } from "../../shared/models.js";
import { extractText } from "../../shared/content.js";
import type { QuerySource } from "../../../src/rag/types.js";

export const FALLBACK_ANSWER =
  "Sorry — I couldn't generate an answer right now. Please try again.";

// System prompt for the answer generator. The context is a numbered list of
// document excerpts ([1], [2], ...); the model cites them by bracket number.
// Beyond the concise default, it gains comparison-aware behaviour so that
// "which is better / which should I pick" questions return a factor table plus
// a grounded recommendation. Keep this in sync with the n8n "Generate Answer"
// node prompt — see docs/superpowers/specs/2026-06-29-rag-comparison-answers-design.md.
export const SYSTEM_PROMPT = `You answer questions using only the provided context, a numbered list of document excerpts ([1], [2], ...). Cite the excerpts you use by their bracket number. Be concise.

When the question asks you to COMPARE options or decide which is better (e.g. "which is better, X or Y", "X vs Y", "should I pick A or B", "compare ..."), structure the answer as:
1. One sentence stating what is being compared.
2. A markdown table with a "Factor" column and one column per option. Include ONLY factors that appear in the context, and put the citation marker(s) ([n]) in each cell. Do not invent values — if a relevant factor is missing from the context, leave it out of the table.
3. A line starting with "Recommendation:" naming the best option, followed by a 1-2 sentence justification that references the tabulated factors.
4. If a relevant factor was missing from the context, add a short "Note:" line saying which information was not found.

If a comparison cannot be answered from the context at all (general knowledge only), you may still give an opinion, but begin with a clear note that it is based on general knowledge, not the provided documents.

When the question asks you to BRAINSTORM or generate ideas/options (e.g. "brainstorm ...", "give me ideas", "what are my options", "suggest approaches", "list some ways to ..."), you may write one short framing sentence, then end your answer with a fenced code block whose opening fence is \`\`\`idss-options containing a SINGLE JSON object of this exact shape:
\`\`\`idss-options
{ "multiSelect": false, "prompt": "Short question shown above the options", "options": [ { "label": "Option title", "description": "One-line rationale, cite [n] when grounded.", "followup": "Question to ask if this option is picked" } ] }
\`\`\`
Set "multiSelect" to false when the options are distinct directions to explore (each becomes a clickable follow-up); set it to true when the options are candidates the user may want to weigh against each other. Provide 4-7 options grounded in the context; if only general knowledge applies, say so in the framing sentence. Put ONLY the JSON inside the block.

Never invent facts or values that are not in the context.`;

export async function generate(state: {
  question: string;
  docs: QuerySource[];
}): Promise<{ answer: string; sources: QuerySource[] }> {
  try {
    const context = state.docs.map((d, i) => `[${i + 1}] ${d.text}`).join("\n\n");
    const res = await makeChatModel().invoke([
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      { role: "user", content: `Context:\n${context}\n\nQuestion: ${state.question}` },
    ]);
    const answer = extractText(res.content);
    return { answer, sources: state.docs };
  } catch {
    return { answer: FALLBACK_ANSWER, sources: [] };
  }
}
