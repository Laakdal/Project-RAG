import { makeIntentModel } from "../../shared/models.js";
import { extractText } from "../../shared/content.js";
import { logNodeError } from "../../shared/log.js";
import { conversationHasAttachments } from "../../shared/attachments.js";
import type { ChatTurn, QuerySource } from "../../../src/rag/types.js";

// Ported from the live n8n "Intent Check" node. Routes the query: useDrive =
// search the user's own documents/library; webSearch = a public/general-
// knowledge question; both false = a creative/build task or small talk that
// generate answers from general knowledge with no retrieval or web search.
const INTENT_INSTRUCTIONS = `You route a document chat. The user MAY have attached file(s) to THIS chat (their text, if any, is below). Reply with ONLY a JSON object, nothing else: {useDrive: boolean, webSearch: boolean}.
useDrive = true when the user asks about the CONTENT of a document, file, report, SOP, manual, journal, or paper; references a SPECIFIC document, letter, or official item (a document/reference number, a dated administrative item such as a memo or surat/nota dinas, or an internal code or acronym such as PPAB / SPPD / DTIS); mentions their Google Drive, library, or company/organization documents; or asks about the user's own organization (e.g. PalmCo) and its activities, projects, letters, or records - UNLESS the attached file(s) below already contain that information. useDrive = false for generic build or creative tasks (flowchart, diagram, code, brainstorm) and for general-knowledge or small-talk questions about the public world.
Important: an unfamiliar acronym, an internal code, or a specific dated reference is far more likely to be the user's OWN internal document than a public topic. When in doubt between the user's documents and the public web, choose useDrive=true and webSearch=false, because a web search cannot see the user's internal documents.
webSearch = true ONLY when the question is a self-contained GENERAL/PUBLIC-knowledge or factual question about the world (a public definition, concept, technology, public company, person, place, event, or current info) that a web search could answer WITHOUT the user's own files, organization, or attachments. webSearch = false when the question refers to or depends on attached/uploaded content, a specific or named document, an official reference or number, or the user's own organization and its records (e.g. 'foto apa ini', 'jelaskan gambar ini', 'apa isi file ini', 'ringkas dokumen ini', 'PPAB tanggal 7 juli 2025'), is a build or creative task, or is a greeting or small talk. If a file is attached below, lean webSearch=false unless the question is clearly a separate general-knowledge question.
Follow-up questions: the user may be continuing an earlier topic with a short message (a yes/no, a pick like 'detail paket X', a pronoun like 'that one', or a request to go deeper). Use the RECENT CONVERSATION below to route these consistently instead of defaulting to false,false: if the recent assistant answers were WEB-search results about a public topic (a public product, company, website, or general fact), keep webSearch=true and useDrive=false; if the recent answers were grounded in the user's own documents or Drive, keep useDrive=true and webSearch=false.
Examples (question -> useDrive,webSearch): 'apa itu css' -> false,true; 'apa itu palmco' -> true,false; 'PPAB tanggal 7 juli 2025' -> true,false; 'surat dinas nomor 110/VII/2025' -> true,false; 'SPPD Jakarta' -> true,false; 'foto apa ini' -> false,false; 'jelaskan gambar ini' -> false,false; 'buatkan flowchart login' -> false,false; 'apa isi SOP IT Project Management' -> true,false; 'ringkas laporan keuangan Q3' -> true,false; 'halo' -> false,false.`;

export async function intent(state: {
  question: string;
  conversationId?: string;
  history?: ChatTurn[];
  docs?: QuerySource[];
}): Promise<{ useDrive: boolean; needsWeb: boolean; hasAttachments: boolean }> {
  // Runs alongside the classifier rather than after it — a cheap indexed count
  // that costs nothing next to the LLM round trip it shares a step with.
  const attachedPromise = state.conversationId
    ? conversationHasAttachments(state.conversationId)
    : Promise.resolve(false);
  try {
    const attached = (state.docs ?? [])
      .map((d) => `${d.filename}: ${d.text}`)
      .join("\n\n")
      .slice(0, 8000);
    const recent = (state.history ?? [])
      .slice(-4)
      .map(
        (m) =>
          `${m.role === "assistant" ? "A: " : "U: "}${String(m.content ?? "")
            .replace(/\s+/g, " ")
            .slice(0, 400)}`,
      )
      .join("\n");
    const content =
      `${INTENT_INSTRUCTIONS}\n\n` +
      `Attached file(s) (may be empty):\n${attached}\n\n` +
      `Recent conversation (most recent last; empty if new chat):\n${recent}\n\n` +
      `Question: ${state.question}`;
    const res = await makeIntentModel().invoke([{ role: "user", content }]);
    const text = extractText(res.content);
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    const parsed = a >= 0 && b > a ? JSON.parse(text.slice(a, b + 1)) : {};
    return {
      useDrive: parsed.useDrive === true,
      needsWeb: parsed.webSearch === true,
      hasAttachments: await attachedPromise,
    };
  } catch (error) {
    // On any failure, prefer the user's own documents — a web search cannot see
    // internal files (matches the n8n "when in doubt, useDrive" guidance).
    logNodeError("intent", error);
    return { useDrive: true, needsWeb: false, hasAttachments: await attachedPromise };
  }
}
