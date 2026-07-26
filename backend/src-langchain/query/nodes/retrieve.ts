import { getVectorStore, getLibraryVectorStore } from "../../shared/qdrant.js";
import { makeEmbeddings } from "../../shared/models.js";
import { logNodeError } from "../../shared/log.js";
import type { QuerySource } from "../../../src/rag/types.js";

type Hit = { pageContent: string; metadata?: Record<string, unknown> };
type Scored = [Hit, number];

// Similarity-score gating (cosine, OpenAI embeddings). Empirically (see the
// retrieve score probe): relevant hits land ~0.5+, off-topic noise ~0.35-0.5.
// FLOOR drops clear noise from both sources. STRONG marks a per-chat upload that
// itself answers the question — when present, only library docs at least as
// relevant as that upload survive, so an uploaded-doc question no longer drags
// in unrelated library PDFs (which scored just below the upload).
const FLOOR = 0.35;
const STRONG = 0.5;
// How far a library hit must beat the best per-chat hit to earn a place beside
// it. Measured across six questions on the live corpus: library NOISE beat the
// upload by at most +0.008, while a genuine library answer beat an unrelated
// upload by at least +0.126 — the two sets do not overlap, and no absolute floor
// separates them (the worst noise, 0.5098, outscores the best genuine hit's
// tail, 0.5063). Anything in (0.008, 0.126] works; 0.05 sits between them.
const MARGIN = 0.05;

function toSource(h: Hit): QuerySource {
  return {
    filename: String(h.metadata?.filename ?? ""),
    chunkIndex: Number(h.metadata?.chunkIndex ?? 0),
    text: h.pageContent,
    webUrl: typeof h.metadata?.webUrl === "string" ? h.metadata.webUrl : undefined,
  };
}

export async function retrieve(state: {
  rewritten: string;
  conversationId: string;
}): Promise<{ docs: QuerySource[]; chatDocs: QuerySource[]; confident: boolean }> {
  try {
    return await search(state);
  } catch (error) {
    // Retrieval now runs speculatively on EVERY query (concurrently with the
    // intent classifier), so it must never be able to fail the whole graph. A
    // greeting used to skip this node entirely; an embedding or Qdrant outage
    // must not start breaking those. Empty docs simply routes on as "found
    // nothing" — grade falls through to Drive/web exactly as intent asked.
    logNodeError("retrieve", error);
    return { docs: [], chatDocs: [], confident: false };
  }
}

async function search(state: {
  rewritten: string;
  conversationId: string;
}): Promise<{ docs: QuerySource[]; chatDocs: QuerySource[]; confident: boolean }> {
  // Embed the query ONCE and reuse the vector for both collections. The two
  // stores share an embedding model and the query is identical, so letting each
  // search embed for itself paid the same ~2s proxied round trip twice.
  const vector = await makeEmbeddings().embedQuery(state.rewritten);
  const filter = { must: [{ key: "metadata.conversationId", match: { value: state.conversationId } }] };

  // Both searches run concurrently — they hit different collections and neither
  // needs the other's result. The library is best-effort: the collection may be
  // empty or absent, so its failure must never break per-chat retrieval.
  const [chatHits, libHits] = (await Promise.all([
    getVectorStore().then((s) => s.similaritySearchVectorWithScore(vector, 5, filter)),
    getLibraryVectorStore()
      .then((s) => s.similaritySearchVectorWithScore(vector, 5))
      .catch((error: unknown) => {
        logNodeError("retrieve (library)", error);
        return [];
      }),
  ])) as [Scored[], Scored[]];

  // Per-chat uploads are NOT score-gated. They are already filtered to this
  // conversation, and the user attached them deliberately — they are context by
  // intent, not by similarity. Deictic questions ("gambar apa ini", "jelaskan
  // ini") share no content words with the document, so they score ~0.25 against
  // their own attachment and the FLOOR silently dropped them. The floor exists
  // to keep noise out of the shared library of many documents; it does not
  // belong on a conversation holding a file the user just uploaded.
  const chatKept = chatHits;
  const topChat = chatKept.reduce((max, [, s]) => Math.max(max, s), 0);
  // A library doc has to clear the floor AND beat the upload by MARGIN to sit
  // beside it. The comparison used to be switched off unless the upload itself
  // scored STRONG — but an on-topic chunk of a user's own thesis tops out around
  // 0.43-0.50 on this corpus, so that escape hatch fired almost every time and
  // handed generate the entire library. With no upload at all, topChat is 0 and
  // this degrades to the plain floor, leaving library-only chats untouched.
  const libKept = libHits.filter(([, s]) => s >= FLOOR && s >= topChat + MARGIN);

  const kept = [...chatKept, ...libKept];
  // Reported separately so the graph can re-attach the user's own file around a
  // driveLookup/webSearch fallback without also re-attaching the library chunks
  // the grader rejected.
  const chatDocs = chatKept.map(([h]) => toSource(h));
  // A hit at or above STRONG is already a confident match, so the graph can skip
  // the LLM relevance grade and answer straight away — one less round trip on
  // the common path. Below that, grade still arbitrates.
  const confident = kept.some(([, s]) => s >= STRONG);

  return { docs: kept.map(([h]) => toSource(h)), chatDocs, confident };
}
