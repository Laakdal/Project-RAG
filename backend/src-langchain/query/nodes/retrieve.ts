import { getVectorStore, getLibraryVectorStore } from "../../shared/qdrant.js";
import type { QuerySource } from "../../../src/rag/types.js";

type Hit = { pageContent: string; metadata?: Record<string, unknown> };

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
  const chatHits = (await store.similaritySearch(state.rewritten, 5, filter)) as Hit[];

  // Shared document library (PalmCo corpus). Best-effort: the collection may be
  // empty or absent, so never let a library failure break per-chat retrieval.
  let libHits: Hit[] = [];
  try {
    const library = await getLibraryVectorStore();
    libHits = (await library.similaritySearch(state.rewritten, 5)) as Hit[];
  } catch {
    libHits = [];
  }

  return { docs: [...chatHits, ...libHits].map(toSource) };
}
