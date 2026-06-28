import { getVectorStore } from "../../shared/qdrant.js";
import type { QuerySource } from "../../../src/rag/types.js";

export async function retrieve(state: {
  rewritten: string;
  conversationId: string;
}): Promise<{ docs: QuerySource[] }> {
  const store = await getVectorStore();
  const filter = { must: [{ key: "metadata.conversationId", match: { value: state.conversationId } }] };
  const hits = await store.similaritySearch(state.rewritten, 5, filter);
  const docs = hits.map((h) => ({
    filename: String(h.metadata?.filename ?? ""),
    chunkIndex: Number(h.metadata?.chunkIndex ?? 0),
    text: h.pageContent,
  }));
  return { docs };
}
