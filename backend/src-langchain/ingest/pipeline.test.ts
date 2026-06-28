import { describe, it, expect, vi, beforeEach } from "vitest";

const addDocuments = vi.fn(async () => undefined);
vi.mock("../shared/qdrant.js", () => ({
  getVectorStore: vi.fn(async () => ({ addDocuments })),
}));
vi.mock("./read.js", () => ({
  readDocument: vi.fn(async () => "alpha beta gamma. delta epsilon."),
}));

describe("ingest pipeline", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads, chunks, and upserts with per-conversation metadata", async () => {
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
});
