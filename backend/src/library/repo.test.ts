import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeDbMock } from "../test/app-harness.js";

const { db, setResult } = makeDbMock();
vi.mock("../db/index.js", () => ({ db }));

const { insertDocument, updateDocument, deleteDocument, listIndexed, summary, findIndexedDriveByFilename } =
  await import("./repo.js");

describe("library repo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("insertDocument returns the new id", async () => {
    setResult([{ id: "doc-1" }]);
    const id = await insertDocument({
      source: "upload",
      sourceRef: null,
      filename: "a.pdf",
      mimeType: "application/pdf",
      chunkCount: 0,
      status: "indexing",
    });
    expect(id).toBe("doc-1");
  });

  it("listIndexed returns rows", async () => {
    setResult([{ id: "doc-1", filename: "a.pdf" }]);
    const rows = await listIndexed();
    expect(rows).toHaveLength(1);
  });

  it("summary returns the aggregate row", async () => {
    setResult([{ total: 3, failed: 1, lastIndexedAt: "2026-07-03T00:00:00Z" }]);
    const s = await summary();
    expect(s.total).toBe(3);
    expect(s.failed).toBe(1);
  });

  it("updateDocument and deleteDocument run without throwing", async () => {
    setResult([]);
    await expect(updateDocument("doc-1", { status: "indexed" })).resolves.toBeUndefined();
    await expect(deleteDocument("doc-1")).resolves.toBeUndefined();
  });

  it("findIndexedDriveByFilename returns the drive id for a matching row", async () => {
    setResult([{ driveFileId: "d1", filename: "a.pdf" }]);
    expect(await findIndexedDriveByFilename("a.pdf")).toEqual({ driveFileId: "d1", filename: "a.pdf" });
  });

  it("findIndexedDriveByFilename returns null when there is no match", async () => {
    setResult([]);
    expect(await findIndexedDriveByFilename("nope.pdf")).toBeNull();
  });
});
