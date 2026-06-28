import { QdrantVectorStore } from "@langchain/qdrant";
import { config } from "../../src/config.js";
import { makeEmbeddings } from "./models.js";

export async function getVectorStore(): Promise<QdrantVectorStore> {
  return QdrantVectorStore.fromExistingCollection(makeEmbeddings(), {
    url: config.QDRANT_URL,
    collectionName: config.QDRANT_COLLECTION_LG,
  });
}
