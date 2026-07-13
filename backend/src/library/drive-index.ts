import { chunkText } from "./chunker.js";
import { upsertChunks, deleteBySource } from "./vector-store.js";
import { insertDocument, updateDocument, existsBySourceRef } from "./repo.js";

// Index a single Drive file (already OCR-extracted to text) into the Qdrant
// library, once. Skips if this driveFileId is already successfully indexed.
// Used by the bulk backfill (n8n → /library/index-drive) to give questions
// semantic coverage across the whole Drive tree, not just per-chat reads.
export async function indexDriveSource(src: {
  driveFileId: string;
  filename: string;
  text: string;
}): Promise<void> {
  if (await existsBySourceRef(src.driveFileId)) return;
  const chunks = await chunkText(src.text || "");
  if (chunks.length === 0) return;
  const id = await insertDocument({
    source: "drive",
    sourceRef: src.driveFileId,
    filename: src.filename || "",
    mimeType: "application/octet-stream",
    chunkCount: 0,
    status: "indexing",
  });
  try {
    await deleteBySource(id);
    await upsertChunks(id, src.filename || "", "drive", chunks);
    await updateDocument(id, { status: "indexed", chunkCount: chunks.length, lastError: null });
  } catch (err) {
    const lastError = err instanceof Error ? err.message : String(err);
    await updateDocument(id, { status: "failed", chunkCount: 0, lastError });
  }
}
