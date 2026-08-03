// backend/src/rag/context-selection.ts
//
// Decide what a question is about: the file(s) attached to this chat, or the
// shared library / Drive. Both the JSON and the streaming chat routes run this,
// so the two can't drift apart.
//
// Similarity score alone can't make the call. A file that extracts to
// keyword-dense text — a diagram, screenshot, spreadsheet, code — scores ~0.2
// against a question squarely about it ("entitas apa saja di ERD ini?"), well
// under any threshold tuned for prose. A fixed gate therefore discards the
// attachment for every question about it, and the library answers instead:
// confidently, correctly cited, and about an entirely different document.
//
// So: take the certain signals first (the user pointed at the file; the file was
// attached to this very question), and only then fall back to score — and even
// then, weigh it against the library rather than against a constant.
import { config } from "../config.js";
import { retrieveAttachmentChunks } from "./attachment-vectors.js";
import { searchLibraryScored, shouldSearchLibrary, librarySufficient } from "../library/retrieve.js";
import { refersToAttachment, attachedForThisTurn } from "./attachment-intent.js";
import type { QuerySource } from "./n8n-client.js";

export type ReadyDoc = {
  filename: string;
  extractedText: string | null;
  createdAt?: Date | string | null;
};

export type SelectedContext = {
  /** Per-chat attachment text to answer from (empty when the library answers). */
  docs: { filename: string; text: string }[];
  /** Shared-library excerpts to answer from (empty when the attachment answers). */
  libraryDocs: QuerySource[];
  /** True when the library provably answers, so the slow live Drive read can be skipped. */
  skipDrive: boolean;
};

export type SelectContextOptions = {
  conversationId: string;
  question: string;
  readyDocs: ReadyDoc[];
  /** Timestamp of the newest prior turn, or null for a fresh conversation. */
  lastTurnAt?: Date | string | null;
  /** Progress reporter for the streaming route; no-op for the JSON route. */
  onStatus?: (message: string, key: string) => void;
};

export async function selectContext(opts: SelectContextOptions): Promise<SelectedContext> {
  const { conversationId, question, readyDocs, lastTurnAt = null, onStatus } = opts;

  let hits: { filename: string; text: string; score: number }[] = [];
  let attTopScore = 0;
  let scopeToAttachment = false;
  // Weak score AND no pointer at the attachment: don't discard it outright,
  // let the library try and give the question to whichever scores better.
  let undecided = false;

  if (readyDocs.length > 0) {
    onStatus?.("Reading your attached file…", "reading");
    let scoringFailed = false;
    try {
      hits = await retrieveAttachmentChunks(conversationId, question, config.CHAT_RETRIEVE_TOP_K);
      attTopScore = hits[0]?.score ?? 0;
    } catch (err) {
      console.error("[chat] per-chat retrieval failed; scoping to attached docs", err);
      scoringFailed = true;
    }
    if (
      // "apa isi file ini", "this document", "the attached…" — the user is
      // pointing at the file, and no score outvotes that.
      refersToAttachment(question) ||
      // Attached to THIS question: uploading a file and asking in the same
      // breath means that file.
      attachedForThisTurn(readyDocs.map((a) => a.createdAt ?? null), lastTurnAt) ||
      // Couldn't score it → stay scoped rather than silently ignore the file.
      scoringFailed ||
      // Comfortably on topic by score alone.
      attTopScore >= config.CHAT_RELEVANCE_THRESHOLD
    ) {
      scopeToAttachment = true;
    } else {
      undecided = true;
    }
  }

  let libraryDocs: QuerySource[] = [];
  // Search the library unless we're already scoped to the attachment. This is
  // the same search the old fixed gate ran on rejection, so the undecided path
  // costs no extra round trip.
  if (!scopeToAttachment) {
    onStatus?.("Searching your documents…", "searching_docs");
    try {
      if (await shouldSearchLibrary(question)) {
        const { docs: libDocs, topScore } = await searchLibraryScored(question);
        // Same embedding model for both corpora, so the scores compare — even
        // though neither means much against a fixed threshold.
        if (undecided && attTopScore >= topScore && attTopScore >= config.CHAT_ATTACHMENT_FLOOR) {
          scopeToAttachment = true;
        } else {
          libraryDocs = libDocs;
        }
      } else if (undecided) {
        // Nothing to weigh it against — the attachment is all we have.
        scopeToAttachment = true;
      }
    } catch {
      libraryDocs = [];
    }
  }

  if (scopeToAttachment) {
    // Whole text for a short doc; retrieved chunks for a big book, whose full
    // text would blow the context window.
    const totalChars = readyDocs.reduce((n, a) => n + (a.extractedText ?? "").length, 0);
    const docs =
      totalChars <= config.CHAT_WHOLE_DOC_MAX_CHARS
        ? readyDocs.map((a) => ({ filename: a.filename, text: a.extractedText ?? "" }))
        : hits.length > 0
          ? hits.map((h) => ({ filename: h.filename, text: h.text }))
          : readyDocs.map((a) => ({
              filename: a.filename,
              text: (a.extractedText ?? "").slice(0, config.CHAT_WHOLE_DOC_MAX_CHARS),
            }));
    return { docs, libraryDocs: [], skipDrive: false };
  }

  let skipDrive = false;
  if (libraryDocs.length > 0) {
    try {
      // Skip the slow live Drive read only when the library provably answers the
      // question; on any doubt, fall through to the live read.
      skipDrive = await librarySufficient(question, libraryDocs);
    } catch {
      skipDrive = false;
    }
  }
  return { docs: [], libraryDocs, skipDrive };
}
