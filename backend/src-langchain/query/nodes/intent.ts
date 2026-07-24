import { makeIntentModel } from "../../shared/models.js";
import { extractText } from "../../shared/content.js";
import { logNodeError } from "../../shared/log.js";
import { conversationHasAttachments } from "../../shared/attachments.js";
import type { ChatTurn, QuerySource } from "../../../src/rag/types.js";

// Ported verbatim from the live n8n "Intent Check" node. Routes the query with
// three flags: useDrive = search the user's own documents/library; webSearch = a
// public/general-knowledge question that needs current/external facts;
// needsReasoning = genuine analysis/decision support (comparisons, ranking,
// multi-step reasoning) — this last flag selects the answer model downstream
// (gemini-2.5-pro when true, else flash). Both useDrive and webSearch false = a
// creative/build task or small talk answered from general knowledge with no
// retrieval or web search.
const INTENT_INSTRUCTIONS = `You route a document chat. The user MAY have attached file(s) to THIS chat (their text, if any, is below). Reply with ONLY a JSON object, nothing else: {useDrive: boolean, webSearch: boolean, needsReasoning: boolean}.
useDrive = true when the user asks about the CONTENT of a document, file, report, SOP, manual, journal, or paper; references a SPECIFIC document, letter, or official item (a document/reference number, a dated administrative item such as a memo or surat/nota dinas, or an internal code or acronym such as PPAB / SPPD / DTIS); mentions their Google Drive, library, or company/organization documents; or asks about the user's own organization (e.g. PalmCo) and its activities, projects, letters, or records - UNLESS the attached file(s) below already contain that information. useDrive = false for generic build or creative tasks (flowchart, diagram, code, brainstorm) and for general-knowledge or small-talk questions about the public world.
Important: an unfamiliar acronym, an internal code, or a specific dated reference is far more likely to be the user's OWN internal document than a public topic. When in doubt between the user's documents and the public web, choose useDrive=true and webSearch=false, because a web search cannot see the user's internal documents.
webSearch = true ONLY when answering needs CURRENT, recent, or specific EXTERNAL facts that a general assistant would not reliably know from its own training - such as recent events or news, current prices/rates/statistics, the latest version or status of something, or specific facts about a particular named public company/product/website/person, or when the user explicitly asks to search or look something up online. webSearch = false for general conceptual, definitional, educational, comparison, how-to, brainstorming, creative, or opinion questions that a knowledgeable assistant can answer well from its own general knowledge - answer those directly and quickly WITHOUT a web search. webSearch = false when the question refers to or depends on attached/uploaded content, a specific or named document, an official reference or number, or the user's own organization and its records (e.g. 'foto apa ini', 'jelaskan gambar ini', 'apa isi file ini', 'ringkas dokumen ini', 'PPAB tanggal 7 juli 2025'), is a build or creative task, or is a greeting or small talk. If a file is attached below, lean webSearch=false unless the question is clearly a separate general-knowledge question.
needsReasoning = true when the question calls for genuine analysis or decision support - comparing options, recommending or deciding which is better, weighing trade-offs, ranking or prioritising, or multi-step reasoning over several facts (e.g. 'which is better X or Y', 'compare and recommend', 'should I pick A or B', 'rank these options'). needsReasoning = false for greetings, chit-chat, simple factual or definitional questions, single-fact lookups, summaries, extractions, and creative or build tasks that do not require weighing options.
Follow-up questions: the user may be continuing an earlier topic with a short message (a yes/no, a pick like 'detail paket X', a pronoun like 'that one', or a request to go deeper). Use the RECENT CONVERSATION below to route these consistently instead of defaulting to false,false: if the recent assistant answers were WEB-search results about a public topic (a public product, company, website, or general fact), keep webSearch=true and useDrive=false; if the recent answers were grounded in the user's own documents or Drive, keep useDrive=true and webSearch=false.
Examples (question -> useDrive,webSearch,needsReasoning): 'apa itu css' -> false,false,false; 'jelaskan konsep agile' -> false,false,false; 'bandingkan agile dan waterfall' -> false,false,true; 'mana yang lebih baik, paket A atau paket B' -> true,false,true; 'harga saham terbaru Apple' -> false,true,false; 'berita terbaru soal AI' -> false,true,false; 'siapa CEO OpenAI saat ini' -> false,true,false; 'apa itu palmco' -> true,false,false; 'PPAB tanggal 7 juli 2025' -> true,false,false; 'surat dinas nomor 110/VII/2025' -> true,false,false; 'SPPD Jakarta' -> true,false,false; 'foto apa ini' -> false,false,false; 'jelaskan gambar ini' -> false,false,false; 'buatkan flowchart login' -> false,false,false; 'apa isi SOP IT Project Management' -> true,false,false; 'ringkas laporan keuangan Q3' -> true,false,false; 'halo' -> false,false,false.`;

export async function intent(state: {
  question: string;
  conversationId?: string;
  history?: ChatTurn[];
  docs?: QuerySource[];
}): Promise<{
  useDrive: boolean;
  needsWeb: boolean;
  needsReasoning: boolean;
  hasAttachments: boolean;
}> {
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
      needsReasoning: parsed.needsReasoning === true,
      hasAttachments: await attachedPromise,
    };
  } catch (error) {
    // On any failure, prefer the user's own documents — a web search cannot see
    // internal files (matches the n8n "when in doubt, useDrive" guidance). Fall
    // back to the cheaper non-reasoning answer model rather than assuming pro.
    logNodeError("intent", error);
    return {
      useDrive: true,
      needsWeb: false,
      needsReasoning: false,
      hasAttachments: await attachedPromise,
    };
  }
}
