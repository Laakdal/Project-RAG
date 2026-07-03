import { chunkText } from "./chunker.js";
import { upsertChunks, deleteBySource } from "./vector-store.js";
import { insertDocument, updateDocument, existsBySourceRef } from "./repo.js";
import type { QuerySource } from "../rag/n8n-client.js";

export function pickDriveSources(sources: QuerySource[]): QuerySource[] {
  return sources.filter(
    (s) =>
      s.origin === "Drive" &&
      s.driveFileId &&
      !s.driveFileId.startsWith("library:") &&
      s.text,
  );
}

// Index a single Drive file (from a query's sources) into the Qdrant library,
// once. Skips if this driveFileId is already indexed.
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

// Fire-and-forget: index any 'Drive'-origin sources from a query. Never throws;
// each failure is swallowed so it can't affect the chat response.
export function indexDriveSourcesInBackground(sources: QuerySource[]): void {
  for (const s of pickDriveSources(sources)) {
    void indexDriveSource({
      driveFileId: s.driveFileId!,
      filename: s.filename,
      text: s.text,
    }).catch(() => {});
  }
}
