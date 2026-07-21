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
}): Promise<{ docs: QuerySource[]; confident: boolean }> {
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

  const chatKept = chatHits.filter(([, s]) => s >= FLOOR);
  const topChat = chatKept.reduce((max, [, s]) => Math.max(max, s), 0);
  // If the uploaded doc clearly answers the question, keep only library docs
  // that are at least as relevant as it; otherwise keep all above the floor.
  const libKept = libHits.filter(([, s]) => s >= FLOOR && (topChat < STRONG || s >= topChat));

  const kept = [...chatKept, ...libKept];
  // A hit at or above STRONG is already a confident match, so the graph can skip
  // the LLM relevance grade and answer straight away — one less round trip on
  // the common path. Below that, grade still arbitrates.
  const confident = kept.some(([, s]) => s >= STRONG);

  return { docs: kept.map(([h]) => toSource(h)), confident };
}
