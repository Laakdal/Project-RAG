import { describe, it, expect, vi, beforeEach } from "vitest";

const insertDocument = vi.fn(async () => "doc-1");
const updateDocument = vi.fn(async () => {});
vi.mock("./repo.js", () => ({ insertDocument, updateDocument }));

const extractText = vi.fn(async () => "some text");
vi.mock("./text-extract.js", () => ({ extractText }));

const chunkText = vi.fn(async () => ["c1", "c2"]);
vi.mock("./chunker.js", () => ({ chunkText }));

const upsertChunks = vi.fn(async () => {});
const deleteBySource = vi.fn(async () => {});
vi.mock("./vector-store.js", () => ({ upsertChunks, deleteBySource }));

const { indexUpload } = await import("./ingest.js");

describe("indexUpload", () => {
  beforeEach(() => vi.clearAllMocks());

  it("indexes a document and reports chunk count", async () => {
    const r = await indexUpload("a.pdf", "application/pdf", Buffer.from("x"));
    expect(r).toEqual({ id: "doc-1", status: "indexed", chunkCount: 2 });
    expect(deleteBySource).toHaveBeenCalledWith("doc-1");
    expect(upsertChunks).toHaveBeenCalledWith("doc-1", "a.pdf", "upload", ["c1", "c2"]);
    expect(updateDocument).toHaveBeenCalledWith("doc-1", { status: "indexed", chunkCount: 2, lastError: null });
    expect(deleteBySource.mock.invocationCallOrder[0]).toBeLessThan(
      upsertChunks.mock.invocationCallOrder[0],
    );
  });

  it("marks the row failed and stores no vectors when no text is extracted", async () => {
    chunkText.mockResolvedValueOnce([]);
    const r = await indexUpload("a.pdf", "application/pdf", Buffer.from("x"));
    expect(r).toEqual({ id: "doc-1", status: "failed", chunkCount: 0 });
    expect(upsertChunks).not.toHaveBeenCalled();
    expect(deleteBySource).not.toHaveBeenCalled();
    expect(updateDocument).toHaveBeenCalledWith("doc-1", { status: "failed", chunkCount: 0, lastError: "no text extracted" });
  });
});
