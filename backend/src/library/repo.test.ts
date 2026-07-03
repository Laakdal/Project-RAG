import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeDbMock } from "../test/app-harness.js";

const { db, setResult } = makeDbMock();
vi.mock("../db/index.js", () => ({ db }));

const { insertDocument, updateDocument, deleteDocument, listIndexed, summary, existsBySourceRef } =
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

  it("existsBySourceRef returns true when a matching row exists", async () => {
    setResult([{ id: "doc-1" }]);
    const found = await existsBySourceRef("file-abc");
    expect(found).toBe(true);
  });

  it("existsBySourceRef returns false when no matching row", async () => {
    setResult([]);
    const found = await existsBySourceRef("file-xyz");
    expect(found).toBe(false);
  });
});
