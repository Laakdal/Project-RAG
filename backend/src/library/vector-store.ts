import { QdrantVectorStore } from "@langchain/qdrant";
import { Document } from "@langchain/core/documents";
import { config } from "../config.js";
import { makeEmbeddings } from "./embeddings.js";

export type LibraryHit = {
  filename: string;
  chunkIndex: number;
  text: string;
  score: number;
};

// Construct a store per call (no memoization) so behavior is easy to reason
// about and to test. ensureCollection creates the collection (with the
// embedding's dimensions) if it does not yet exist.
async function getStore(): Promise<QdrantVectorStore> {
  if (!config.QDRANT_URL) {
    throw new Error("QDRANT_URL is required for the library");
  }
  const store = new QdrantVectorStore(makeEmbeddings(), {
    url: config.QDRANT_URL,
    collectionName: config.QDRANT_COLLECTION_LIBRARY,
  });
  await store.ensureCollection();
  return store;
}

export async function upsertChunks(
  sourceId: string,
  filename: string,
  source: string,
  chunks: string[],
): Promise<void> {
  if (chunks.length === 0) return;
  const store = await getStore();
  const docs = chunks.map(
    (content, chunkIndex) =>
      new Document({
        pageContent: content,
        metadata: { sourceId, filename, chunkIndex, source },
      }),
  );
  await store.addDocuments(docs);
}

export async function search(question: string, k: number): Promise<LibraryHit[]> {
  const store = await getStore();
  const results = await store.similaritySearchWithScore(question, k);
  return results.map(([doc, score]) => ({
    filename: String(doc.metadata?.filename ?? ""),
    chunkIndex: Number(doc.metadata?.chunkIndex ?? 0),
    text: doc.pageContent,
    score,
  }));
}

export async function deleteBySource(sourceId: string): Promise<void> {
  const store = await getStore();
  await store.client.delete(config.QDRANT_COLLECTION_LIBRARY, {
    filter: { must: [{ key: "metadata.sourceId", match: { value: sourceId } }] },
  });
}
