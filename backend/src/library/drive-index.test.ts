import { describe, it, expect, vi, beforeEach } from "vitest";

const chunkText = vi.fn(async (t: string) => (t ? [t] : []));
vi.mock("./chunker.js", () => ({ chunkText }));

const upsertChunks = vi.fn(async () => {});
const deleteBySource = vi.fn(async () => {});
vi.mock("./vector-store.js", () => ({ upsertChunks, deleteBySource }));

const existsBySourceRef = vi.fn(async () => false);
const insertDocument = vi.fn(async () => "doc-1");
const updateDocument = vi.fn(async () => {});
vi.mock("./repo.js", () => ({ existsBySourceRef, insertDocument, updateDocument }));

const { indexDriveSource } = await import("./drive-index.js");

describe("indexDriveSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsBySourceRef.mockResolvedValue(false);
    chunkText.mockImplementation(async (t: string) => (t ? [t] : []));
  });

  it("chunks, embeds, and marks the doc indexed", async () => {
    await indexDriveSource({ driveFileId: "d1", filename: "trip.pdf", text: "SPPD ke Jakarta" });
    expect(insertDocument).toHaveBeenCalledWith(
      expect.objectContaining({ source: "drive", sourceRef: "d1", status: "indexing" }),
    );
    expect(upsertChunks).toHaveBeenCalledWith("doc-1", "trip.pdf", "drive", ["SPPD ke Jakarta"]);
    expect(updateDocument).toHaveBeenLastCalledWith(
      "doc-1",
      expect.objectContaining({ status: "indexed", chunkCount: 1 }),
    );
  });

  it("skips a source that is already indexed", async () => {
    existsBySourceRef.mockResolvedValueOnce(true);
    await indexDriveSource({ driveFileId: "d1", filename: "trip.pdf", text: "x" });
    expect(insertDocument).not.toHaveBeenCalled();
    expect(upsertChunks).not.toHaveBeenCalled();
  });

  it("does nothing when the text yields no chunks", async () => {
    await indexDriveSource({ driveFileId: "d1", filename: "trip.pdf", text: "" });
    expect(insertDocument).not.toHaveBeenCalled();
  });

  it("marks the doc failed when embedding throws", async () => {
    upsertChunks.mockRejectedValueOnce(new Error("403 blocked"));
    await indexDriveSource({ driveFileId: "d1", filename: "trip.pdf", text: "x" });
    expect(updateDocument).toHaveBeenLastCalledWith(
      "doc-1",
      expect.objectContaining({ status: "failed", lastError: "403 blocked" }),
    );
  });
});
