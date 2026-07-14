// backend/src/rag/attachment-vectors.ts
//
// Per-chat retrieval (RAG) for uploaded documents. A big book's extracted text is
// millions of characters — far past the answer model's context window — so instead
// of injecting the whole thing, we chunk + embed each attachment into Qdrant
// (scoped by conversationId) at read time, and at query time retrieve only the
// chunks relevant to the question. Mirrors the shared-library vector store
// (src/library/vector-store.ts) but keyed per conversation.
import { QdrantVectorStore } from "@langchain/qdrant";
import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { OpenAIEmbeddings } from "@langchain/openai";
import { config } from "../config.js";

const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 150 });

function makeEmbeddings(): OpenAIEmbeddings {
  if (!config.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for chat-attachment embeddings");
  return new OpenAIEmbeddings({ apiKey: config.OPENAI_API_KEY, model: config.EMBED_MODEL });
}

// A fresh store per call (no memoization — matches the library store). ensureCollection
// creates the per-chat collection at the embedding's dimensions if it doesn't exist.
async function getStore(): Promise<QdrantVectorStore> {
  if (!config.QDRANT_URL) throw new Error("QDRANT_URL is required for chat-attachment retrieval");
  const store = new QdrantVectorStore(makeEmbeddings(), {
    url: config.QDRANT_URL,
    collectionName: config.QDRANT_COLLECTION_CHAT,
  });
  await store.ensureCollection();
  return store;
}

// Chunk + embed one attachment's extracted text, scoped to its conversation.
// Returns the number of chunks stored.
export async function embedAttachment(
  conversationId: string,
  attachmentId: string,
  filename: string,
  text: string,
): Promise<number> {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const chunks = await splitter.splitText(trimmed);
  if (chunks.length === 0) return 0;
  const store = await getStore();
  const docs = chunks.map(
    (content, chunkIndex) =>
      new Document({ pageContent: content, metadata: { conversationId, attachmentId, filename, chunkIndex } }),
  );
  await store.addDocuments(docs);
  return chunks.length;
}

// Retrieve the top-k chunks relevant to `question` within one conversation.
export async function retrieveAttachmentChunks(
  conversationId: string,
  question: string,
  k: number,
): Promise<{ filename: string; text: string }[]> {
  const store = await getStore();
  const results = await store.similaritySearchWithScore(question, k, {
    must: [{ key: "metadata.conversationId", match: { value: conversationId } }],
  });
  return results.map(([doc]) => ({ filename: String(doc.metadata?.filename ?? ""), text: doc.pageContent }));
}

// Best-effort cleanup of an attachment's chunks (called when it's deleted).
export async function deleteAttachmentVectors(attachmentId: string): Promise<void> {
  if (!config.QDRANT_URL) return;
  const store = await getStore();
  await store.client.delete(config.QDRANT_COLLECTION_CHAT, {
    filter: { must: [{ key: "metadata.attachmentId", match: { value: attachmentId } }] },
  });
}
