import { describe, it, expect, vi, beforeEach } from "vitest";

const addDocuments = vi.fn(async () => undefined);
const readDocumentMock = vi.fn(async () => "alpha beta gamma. delta epsilon.");
vi.mock("../shared/qdrant.js", () => ({
  getVectorStore: vi.fn(async () => ({ addDocuments })),
}));
vi.mock("./read.js", () => ({
  readDocument: readDocumentMock,
}));

describe("ingest pipeline", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads, chunks, and upserts with per-conversation metadata", async () => {
    readDocumentMock.mockResolvedValueOnce("alpha beta gamma. delta epsilon.");
    const { ingest } = await import("./pipeline.js");
    const result = await ingest("c1", "doc.pdf", Buffer.from("%PDF"), "application/pdf");
    expect(result.status).toBe("ok");
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(addDocuments).toHaveBeenCalledTimes(1);
    const docs = (addDocuments.mock.calls[0] as unknown as [{ metadata: Record<string, unknown> }[]])[0];
    expect(docs[0].metadata).toMatchObject({
      conversationId: "c1",
      filename: "doc.pdf",
      chunkIndex: 0,
    });
  });

  it("returns status:failed and does not call addDocuments when the reader returns empty text", async () => {
    readDocumentMock.mockResolvedValueOnce("");
    const { ingest } = await import("./pipeline.js");
    const result = await ingest("c1", "empty.pdf", Buffer.from(""), "application/pdf");
    expect(result).toEqual({ status: "failed", chunkCount: 0 });
    expect(addDocuments).not.toHaveBeenCalled();
  });
});
