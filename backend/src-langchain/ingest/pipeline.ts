import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";
import { readDocument } from "./read.js";
import { getVectorStore } from "../shared/qdrant.js";
import type { IngestResult } from "../../src/rag/types.js";

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 150,
});

export async function ingest(
  conversationId: string,
  filename: string,
  file: Buffer,
  mimeType: string,
): Promise<IngestResult> {
  const text = await readDocument(file, mimeType);
  const chunks = await splitter.splitText(text);
  const docs = chunks.map(
    (content, chunkIndex) =>
      new Document({
        pageContent: content,
        metadata: { conversationId, filename, chunkIndex },
      }),
  );
  if (docs.length === 0) {
    return { status: "failed", chunkCount: 0 };
  }
  const store = await getVectorStore();
  await store.addDocuments(docs);
  return { status: "ok", chunkCount: docs.length };
}
