import { QdrantVectorStore } from "@langchain/qdrant";
import type { Document } from "@langchain/core/documents";
import { config } from "../../src/config.js";
import { makeEmbeddings } from "./models.js";

export async function getVectorStore(): Promise<QdrantVectorStore> {
  return QdrantVectorStore.fromExistingCollection(makeEmbeddings(), {
    url: config.QDRANT_URL,
    collectionName: config.QDRANT_COLLECTION_LG,
  });
}

export async function getLibraryVectorStore(): Promise<QdrantVectorStore> {
  return QdrantVectorStore.fromExistingCollection(makeEmbeddings(), {
    url: config.QDRANT_URL,
    collectionName: config.QDRANT_COLLECTION_LIBRARY,
  });
}

export async function upsertLibraryDocuments(docs: Document[]): Promise<void> {
  if (docs.length === 0) return;
  const store = await getLibraryVectorStore();
  await store.addDocuments(docs);
}

export async function deleteLibraryFile(driveFileId: string): Promise<void> {
  const store = await getLibraryVectorStore();
  // The LangChain store wraps a @qdrant/js-client-rest client at `.client`.
  // Delete every point whose payload metadata.driveFileId matches.
  await store.client.delete(config.QDRANT_COLLECTION_LIBRARY, {
    filter: { must: [{ key: "metadata.driveFileId", match: { value: driveFileId } }] },
  });
}
