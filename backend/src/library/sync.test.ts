import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config.js", () => ({
  config: { DRIVE_FOLDER_ID: "f1", QDRANT_COLLECTION_LIBRARY: "project_rag_library" },
}));
const listFolder = vi.fn();
const downloadFile = vi.fn(async () => ({ buffer: Buffer.from("x"), mimeType: "application/pdf" }));
vi.mock("../../src-langchain/library/drive.js", () => ({ listFolder, downloadFile }));
vi.mock("../../src-langchain/ingest/read.js", () => ({ readDocument: vi.fn(async () => "alpha beta gamma") }));
const upsertLibraryDocuments = vi.fn();
const deleteLibraryFile = vi.fn();
vi.mock("../../src-langchain/shared/qdrant.js", () => ({ upsertLibraryDocuments, deleteLibraryFile }));
const listIndexed = vi.fn(async () => [{ driveFileId: "old", modifiedTime: "t" }]);
const upsertDocument = vi.fn();
const deleteDocument = vi.fn();
vi.mock("./repo.js", () => ({ listIndexed, upsertDocument, deleteDocument }));

describe("library sync orchestrator", () => {
  beforeEach(() => vi.clearAllMocks());

  it("indexes new files, removes deleted, isolates per-file failures", async () => {
    listFolder.mockResolvedValue([
      { id: "n1", name: "n1.pdf", mimeType: "application/pdf", modifiedTime: "t1", webUrl: "u" },
      { id: "n2", name: "n2.pdf", mimeType: "application/pdf", modifiedTime: "t2", webUrl: "u" },
    ]); // "old" not present -> removed
    downloadFile.mockImplementationOnce(async () => {
      throw new Error("drive 404");
    }); // n1 fails, n2 succeeds (default impl)

    const { runSync } = await import("./sync.js");
    const r = await runSync();

    expect(r.added).toBe(1); // n2 indexed
    expect(r.failed).toBe(1); // n1 failed but did not abort
    expect(r.deleted).toBe(1); // "old" removed
    expect(deleteLibraryFile).toHaveBeenCalledWith("old");
    expect(upsertLibraryDocuments).toHaveBeenCalledTimes(1);
  });
});
