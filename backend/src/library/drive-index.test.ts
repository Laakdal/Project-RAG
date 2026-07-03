import { describe, it, expect, vi, beforeEach } from "vitest";

const existsBySourceRef = vi.fn(async () => false);
const insertDocument = vi.fn(async () => "doc-1");
const updateDocument = vi.fn(async () => {});
vi.mock("./repo.js", () => ({ existsBySourceRef, insertDocument, updateDocument }));

const chunkText = vi.fn(async () => ["c1", "c2"]);
vi.mock("./chunker.js", () => ({ chunkText }));

const upsertChunks = vi.fn(async () => {});
const deleteBySource = vi.fn(async () => {});
vi.mock("./vector-store.js", () => ({ upsertChunks, deleteBySource }));

const { indexDriveSource, indexDriveSourcesInBackground, pickDriveSources } =
  await import("./drive-index.js");

describe("pickDriveSources", () => {
  it("returns only Drive-origin sources with a real driveFileId and text", () => {
    const sources = [
      { filename: "a.pdf", chunkIndex: 0, text: "hi", origin: "Drive", driveFileId: "file-abc" },
      { filename: "b.pdf", chunkIndex: 0, text: "bye", origin: "Library", driveFileId: "file-lib" },
      { filename: "c.pdf", chunkIndex: 0, text: "yo", origin: "This chat", driveFileId: undefined },
      { filename: "d.pdf", chunkIndex: 0, text: "x", origin: "Drive", driveFileId: "library:xyz" },
      { filename: "e.pdf", chunkIndex: 0, text: "", origin: "Drive", driveFileId: "file-no-text" },
      { filename: "f.pdf", chunkIndex: 0, text: "ok", origin: "Drive", driveFileId: "file-2" },
    ];
    const picked = pickDriveSources(sources);
    expect(picked).toHaveLength(2);
    expect(picked[0].driveFileId).toBe("file-abc");
    expect(picked[1].driveFileId).toBe("file-2");
  });
});

describe("indexDriveSource", () => {
  beforeEach(() => vi.clearAllMocks());

  it("skips entirely when already indexed", async () => {
    existsBySourceRef.mockResolvedValueOnce(true);
    await indexDriveSource({ driveFileId: "file-1", filename: "a.pdf", text: "hello" });
    expect(insertDocument).not.toHaveBeenCalled();
    expect(upsertChunks).not.toHaveBeenCalled();
  });

  it("indexes a new file: insert → delete → upsert → update indexed", async () => {
    existsBySourceRef.mockResolvedValueOnce(false);
    await indexDriveSource({ driveFileId: "file-2", filename: "b.pdf", text: "world" });

    expect(insertDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "drive",
        sourceRef: "file-2",
        filename: "b.pdf",
        status: "indexing",
      }),
    );
    expect(deleteBySource).toHaveBeenCalledWith("doc-1");
    expect(upsertChunks).toHaveBeenCalledWith("doc-1", "b.pdf", "drive", ["c1", "c2"]);
    expect(updateDocument).toHaveBeenCalledWith("doc-1", {
      status: "indexed",
      chunkCount: 2,
      lastError: null,
    });

    // delete must come before upsert
    expect(deleteBySource.mock.invocationCallOrder[0]).toBeLessThan(
      upsertChunks.mock.invocationCallOrder[0],
    );
  });

  it("marks failed when upsert throws, without re-throwing", async () => {
    existsBySourceRef.mockResolvedValueOnce(false);
    upsertChunks.mockRejectedValueOnce(new Error("qdrant down"));

    await expect(
      indexDriveSource({ driveFileId: "file-3", filename: "c.pdf", text: "data" }),
    ).resolves.toBeUndefined();

    expect(updateDocument).toHaveBeenCalledWith("doc-1", {
      status: "failed",
      chunkCount: 0,
      lastError: "qdrant down",
    });
  });

  it("returns without inserting when chunkText returns no chunks", async () => {
    existsBySourceRef.mockResolvedValueOnce(false);
    chunkText.mockResolvedValueOnce([]);

    await indexDriveSource({ driveFileId: "file-4", filename: "d.pdf", text: "  " });

    expect(insertDocument).not.toHaveBeenCalled();
    expect(upsertChunks).not.toHaveBeenCalled();
  });
});

describe("indexDriveSourcesInBackground", () => {
  beforeEach(() => vi.clearAllMocks());

  it("triggers indexing only for Drive sources with real ids", async () => {
    existsBySourceRef.mockResolvedValue(false);

    indexDriveSourcesInBackground([
      { filename: "a.pdf", chunkIndex: 0, text: "txt", origin: "Drive", driveFileId: "file-a" },
      { filename: "b.pdf", chunkIndex: 0, text: "txt", origin: "Library", driveFileId: "lib-b" },
      { filename: "c.pdf", chunkIndex: 0, text: "txt", origin: "Drive", driveFileId: "library:c" },
      { filename: "d.pdf", chunkIndex: 0, text: "txt2", origin: "Drive", driveFileId: "file-d" },
    ]);

    // Wait one microtask tick so the void promises settle before asserting.
    await new Promise((r) => setImmediate(r));

    // Only file-a and file-d should be passed to existsBySourceRef.
    expect(existsBySourceRef).toHaveBeenCalledTimes(2);
    expect(existsBySourceRef).toHaveBeenCalledWith("file-a");
    expect(existsBySourceRef).toHaveBeenCalledWith("file-d");
  });

  it("does not throw when indexing fails", () => {
    existsBySourceRef.mockRejectedValue(new Error("db gone"));
    expect(() =>
      indexDriveSourcesInBackground([
        { filename: "x.pdf", chunkIndex: 0, text: "t", origin: "Drive", driveFileId: "file-x" },
      ]),
    ).not.toThrow();
  });
});
