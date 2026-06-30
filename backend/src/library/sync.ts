import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";
import { config } from "../config.js";
import { listFolder, downloadFile } from "../../src-langchain/library/drive.js";
import { readDocument } from "../../src-langchain/ingest/read.js";
import { upsertLibraryDocuments, deleteLibraryFile } from "../../src-langchain/shared/qdrant.js";
import { classifyFiles } from "./diff.js";
import { listIndexed, upsertDocument, deleteDocument } from "./repo.js";

const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 150 });

export async function runSync() {
  if (!config.DRIVE_FOLDER_ID) throw new Error("DRIVE_FOLDER_ID required");
  const driveFiles = await listFolder(config.DRIVE_FOLDER_ID);
  const indexed = await listIndexed();
  const { toIndex, toRemove } = classifyFiles(driveFiles, indexed);

  const result = {
    added: 0,
    updated: 0,
    deleted: 0,
    skipped: driveFiles.length - toIndex.length,
    failed: 0,
    failures: [] as { driveFileId: string; error: string }[],
  };
  const seen = new Set(indexed.map((r) => r.driveFileId));

  for (const file of toIndex) {
    try {
      // Re-index = clear old vectors first so changed files leave no stale chunks.
      if (seen.has(file.id)) await deleteLibraryFile(file.id);
      const { buffer, mimeType } = await downloadFile(file);
      const text = await readDocument(buffer, mimeType);
      const chunks = await splitter.splitText(text);
      if (chunks.length === 0) throw new Error("no text extracted");
      const docs = chunks.map(
        (content, chunkIndex) =>
          new Document({
            pageContent: content,
            metadata: {
              driveFileId: file.id,
              filename: file.name,
              webUrl: file.webUrl,
              chunkIndex,
              modifiedTime: file.modifiedTime,
            },
          }),
      );
      await upsertLibraryDocuments(docs);
      await upsertDocument({
        driveFileId: file.id,
        filename: file.name,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime,
        chunkCount: chunks.length,
        status: "indexed",
        webUrl: file.webUrl,
        lastError: null,
      });
      if (seen.has(file.id)) result.updated++;
      else result.added++;
    } catch (err) {
      result.failed++;
      const error = err instanceof Error ? err.message : String(err);
      result.failures.push({ driveFileId: file.id, error });
      await upsertDocument({
        driveFileId: file.id,
        filename: file.name,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime,
        chunkCount: 0,
        status: "failed",
        webUrl: file.webUrl,
        lastError: error,
      });
    }
  }

  for (const id of toRemove) {
    await deleteLibraryFile(id);
    await deleteDocument(id);
    result.deleted++;
  }

  return result;
}
