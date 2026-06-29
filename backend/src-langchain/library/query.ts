import { rewrite } from "../query/nodes/rewrite.js";
import { generate } from "../query/nodes/generate.js";
import { getLibraryVectorStore } from "../shared/qdrant.js";
import type { ChatTurn, QuerySource } from "../../src/rag/types.js";

const NO_RESULTS = "I couldn't find anything relevant in the library.";

export async function queryLibrary(
  question: string,
  history: ChatTurn[],
): Promise<{ answer: string; sources: QuerySource[] }> {
  // Resolve follow-ups against history (reused Phase 1 node), then search the
  // shared library collection — no conversation filter.
  const { rewritten } = await rewrite({ question, history });
  const store = await getLibraryVectorStore();
  const hits = await store.similaritySearch(rewritten, 8);
  const docs: QuerySource[] = hits.map((h) => ({
    filename: String(h.metadata?.filename ?? ""),
    chunkIndex: Number(h.metadata?.chunkIndex ?? 0),
    text: h.pageContent,
    webUrl: typeof h.metadata?.webUrl === "string" ? h.metadata.webUrl : undefined,
  }));
  if (docs.length === 0) return { answer: NO_RESULTS, sources: [] };
  return generate({ question, docs });
}
