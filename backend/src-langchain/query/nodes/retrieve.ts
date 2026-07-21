import { getVectorStore, getLibraryVectorStore } from "../../shared/qdrant.js";
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
}): Promise<{ docs: QuerySource[] }> {
  // Per-chat uploads (scoped to this conversation).
  const store = await getVectorStore();
  const filter = { must: [{ key: "metadata.conversationId", match: { value: state.conversationId } }] };
  const chatHits = (await store.similaritySearchWithScore(state.rewritten, 5, filter)) as Scored[];

  // Shared document library (PalmCo corpus). Best-effort: the collection may be
  // empty or absent, so never let a library failure break per-chat retrieval.
  let libHits: Scored[] = [];
  try {
    const library = await getLibraryVectorStore();
    libHits = (await library.similaritySearchWithScore(state.rewritten, 5)) as Scored[];
  } catch (error) {
    logNodeError("retrieve (library)", error);
    libHits = [];
  }

  const chatKept = chatHits.filter(([, s]) => s >= FLOOR);
  const topChat = chatKept.reduce((max, [, s]) => Math.max(max, s), 0);
  // If the uploaded doc clearly answers the question, keep only library docs
  // that are at least as relevant as it; otherwise keep all above the floor.
  const libKept = libHits.filter(([, s]) => s >= FLOOR && (topChat < STRONG || s >= topChat));

  return { docs: [...chatKept, ...libKept].map(([h]) => toSource(h)) };
}
