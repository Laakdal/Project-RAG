import { extractText } from "./text-extract.js";
import { chunkText } from "./chunker.js";
import { upsertChunks, deleteBySource } from "./vector-store.js";
import { insertDocument, updateDocument } from "./repo.js";

export type IngestLibraryResult = {
  id: string;
  status: "indexed" | "failed";
  chunkCount: number;
};

export async function indexUpload(
  filename: string,
  mimeType: string,
  file: Buffer,
): Promise<IngestLibraryResult> {
  const id = await insertDocument({
    source: "upload",
    sourceRef: null,
    filename,
    mimeType,
    chunkCount: 0,
    status: "indexing",
  });
  try {
    const text = await extractText(file, filename, mimeType);
    const chunks = await chunkText(text);
    if (chunks.length === 0) throw new Error("no text extracted");
    // Clear any prior vectors for this id before writing (safe re-index).
    await deleteBySource(id);
    await upsertChunks(id, filename, "upload", chunks);
    await updateDocument(id, { status: "indexed", chunkCount: chunks.length, lastError: null });
    return { id, status: "indexed", chunkCount: chunks.length };
  } catch (err) {
    const lastError = err instanceof Error ? err.message : String(err);
    await updateDocument(id, { status: "failed", chunkCount: 0, lastError });
    return { id, status: "failed", chunkCount: 0 };
  }
}
