import type { DriveFile } from "../../src-langchain/library/drive.js";

// Pure classification of a Drive listing against the currently-indexed rows.
// toIndex = files that are new or whose modifiedTime changed; toRemove = indexed
// driveFileIds no longer present in Drive.
export function classifyFiles(
  driveFiles: DriveFile[],
  indexed: { driveFileId: string; modifiedTime: string }[],
): { toIndex: DriveFile[]; toRemove: string[] } {
  const byId = new Map(indexed.map((r) => [r.driveFileId, r.modifiedTime]));
  const driveIds = new Set(driveFiles.map((f) => f.id));
  const toIndex = driveFiles.filter((f) => {
    const prev = byId.get(f.id);
    return prev === undefined || prev !== f.modifiedTime;
  });
  const toRemove = indexed
    .filter((r) => !driveIds.has(r.driveFileId))
    .map((r) => r.driveFileId);
  return { toIndex, toRemove };
}
