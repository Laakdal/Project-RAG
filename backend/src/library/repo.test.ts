import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeDbMock } from "../test/app-harness.js";

const dbMock = makeDbMock();
vi.mock("../db/index.js", () => ({ db: dbMock.db }));
const { listIndexed, upsertDocument, deleteDocument, summary } = await import("./repo.js");

describe("library repo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("listIndexed reads library_documents", async () => {
    dbMock.setResult([{ driveFileId: "a", modifiedTime: "t", status: "indexed" }]);
    const rows = await listIndexed();
    expect(rows[0].driveFileId).toBe("a");
  });

  it("upsertDocument inserts with onConflictDoUpdate", async () => {
    const insertSpy = dbMock.db.insert as ReturnType<typeof vi.fn>;
    const conflictSpy = dbMock.db.onConflictDoUpdate as ReturnType<typeof vi.fn>;
    await upsertDocument({
      driveFileId: "a", filename: "a", mimeType: "application/pdf",
      modifiedTime: "t", chunkCount: 1, status: "indexed", webUrl: "u", lastError: null,
    });
    expect(insertSpy).toHaveBeenCalled();
    expect(conflictSpy).toHaveBeenCalled();
  });

  it("deleteDocument issues a delete", async () => {
    const deleteSpy = dbMock.db.delete as ReturnType<typeof vi.fn>;
    await deleteDocument("a");
    expect(deleteSpy).toHaveBeenCalled();
  });

  it("summary returns the aggregate row", async () => {
    dbMock.setResult([{ total: 3, failed: 1, lastIndexedAt: "t" }]);
    const s = await summary();
    expect(s.total).toBe(3);
    expect(s.failed).toBe(1);
  });
});
