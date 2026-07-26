import { describe, it, expect, vi, beforeEach } from "vitest";

const chatSearch = vi.fn();
const librarySearch = vi.fn();
vi.mock("../../shared/qdrant.js", () => ({
  getVectorStore: vi.fn(async () => ({ similaritySearchVectorWithScore: chatSearch })),
  getLibraryVectorStore: vi.fn(async () => ({ similaritySearchVectorWithScore: librarySearch })),
}));

// retrieve embeds the query itself now (once, for both searches) instead of
// letting each store embed for itself.
const embedQuery = vi.fn(async () => [0.1, 0.2, 0.3]);
vi.mock("../../shared/models.js", () => ({
  makeEmbeddings: vi.fn(() => ({ embedQuery })),
}));

const chatDoc = { pageContent: "chunk text", metadata: { filename: "doc.pdf", chunkIndex: 2 } };
const libDoc = { pageContent: "library text", metadata: { filename: "lib.pdf", chunkIndex: 0, webUrl: "http://drive/x" } };

describe("retrieve node", () => {
  beforeEach(() => vi.clearAllMocks());

  it("scopes the per-chat search to the conversation", async () => {
    chatSearch.mockResolvedValueOnce([[chatDoc, 0.6]]);
    librarySearch.mockResolvedValueOnce([]);
    const { retrieve } = await import("./retrieve.js");
    await retrieve({ rewritten: "q", conversationId: "c1" } as never);
    const [, k, filter] = chatSearch.mock.calls[0] as unknown as [number[], number, unknown];
    expect(k).toBe(5);
    expect(JSON.stringify(filter)).toContain("c1");
  });

  it("reports the per-chat hits separately from the library ones", async () => {
    // The graph re-attaches chatDocs around driveLookup/webSearch so a fallback
    // cannot discard the file the user uploaded; it must be able to tell the two
    // sources apart.
    chatSearch.mockResolvedValueOnce([[chatDoc, 0.4]]);
    librarySearch.mockResolvedValueOnce([[libDoc, 0.45]]);
    const { retrieve } = await import("./retrieve.js");
    const out = await retrieve({ rewritten: "q", conversationId: "c1" } as never);
    expect(out.docs.map((d) => d.filename)).toEqual(["doc.pdf", "lib.pdf"]);
    expect(out.chatDocs.map((d) => d.filename)).toEqual(["doc.pdf"]);
  });

  it("reports no per-chat hits when the conversation has no upload", async () => {
    chatSearch.mockResolvedValueOnce([]);
    librarySearch.mockResolvedValueOnce([[libDoc, 0.6]]);
    const { retrieve } = await import("./retrieve.js");
    const out = await retrieve({ rewritten: "q", conversationId: "c1" } as never);
    expect(out.chatDocs).toEqual([]);
  });

  it("embeds the query once and reuses the vector for both collections", async () => {
    chatSearch.mockResolvedValueOnce([[chatDoc, 0.6]]);
    librarySearch.mockResolvedValueOnce([[libDoc, 0.6]]);
    const { retrieve } = await import("./retrieve.js");
    await retrieve({ rewritten: "q", conversationId: "c1" } as never);
    expect(embedQuery).toHaveBeenCalledTimes(1);
    const [chatVector] = chatSearch.mock.calls[0] as unknown as [number[]];
    const [libVector] = librarySearch.mock.calls[0] as unknown as [number[]];
    expect(chatVector).toEqual([0.1, 0.2, 0.3]);
    expect(libVector).toEqual(chatVector);
  });

  it("reports confidence only when a hit reaches the STRONG score", async () => {
    chatSearch.mockResolvedValueOnce([[chatDoc, 0.55]]);
    librarySearch.mockResolvedValueOnce([]);
    const { retrieve } = await import("./retrieve.js");
    expect((await retrieve({ rewritten: "q", conversationId: "c1" } as never)).confident).toBe(true);

    vi.clearAllMocks();
    chatSearch.mockResolvedValueOnce([[chatDoc, 0.4]]); // above floor, below strong
    librarySearch.mockResolvedValueOnce([]);
    expect((await retrieve({ rewritten: "q", conversationId: "c1" } as never)).confident).toBe(false);
  });

  it("keeps a strongly-relevant upload and drops off-topic library noise", async () => {
    chatSearch.mockResolvedValueOnce([[chatDoc, 0.55]]);
    librarySearch.mockResolvedValueOnce([[libDoc, 0.49]]); // below the upload -> noise
    const { retrieve } = await import("./retrieve.js");
    const out = await retrieve({ rewritten: "q", conversationId: "c1" } as never);
    expect(out.docs.map((d) => d.filename)).toEqual(["doc.pdf"]);
  });

  it("keeps a low-scoring per-chat upload alongside a strong library hit", async () => {
    // A deictic question ("gambar apa ini") scores ~0.25 against its own
    // attachment, so gating uploads by score hid the very file the user just
    // attached. Uploads are conversation-scoped and deliberate — always context.
    chatSearch.mockResolvedValueOnce([[chatDoc, 0.2]]);
    librarySearch.mockResolvedValueOnce([[libDoc, 0.6]]);
    const { retrieve } = await import("./retrieve.js");
    const out = await retrieve({ rewritten: "q", conversationId: "c1" } as never);
    expect(out.docs.map((d) => d.filename)).toEqual(["doc.pdf", "lib.pdf"]);
  });

  it("keeps library docs that are more relevant than the upload", async () => {
    chatSearch.mockResolvedValueOnce([[chatDoc, 0.55]]);
    librarySearch.mockResolvedValueOnce([[libDoc, 0.7]]); // beats the upload -> kept
    const { retrieve } = await import("./retrieve.js");
    const out = await retrieve({ rewritten: "q", conversationId: "c1" } as never);
    expect(out.docs.map((d) => d.filename)).toEqual(["doc.pdf", "lib.pdf"]);
  });

  it("drops library noise that merely floats near a middling upload score", async () => {
    // Measured on the live dev corpus: asking about an attached thesis scores
    // 0.4347 against the thesis itself and 0.3875 against an unrelated laptop
    // invoice. Because the upload never reached STRONG, the old rule switched off
    // the relative comparison entirely and admitted the whole library — which is
    // how four unrelated company PDFs ended up cited in an answer about the
    // user's own document.
    chatSearch.mockResolvedValueOnce([[chatDoc, 0.4347]]);
    librarySearch.mockResolvedValueOnce([[libDoc, 0.3875]]);
    const { retrieve } = await import("./retrieve.js");
    const out = await retrieve({ rewritten: "q", conversationId: "c1" } as never);
    expect(out.docs.map((d) => d.filename)).toEqual(["doc.pdf"]);
  });

  it("keeps a library hit that clearly beats an unrelated upload", async () => {
    // Also measured: a genuine library question scores 0.6607 against the right
    // document while the chat's unrelated attachment sits at 0.3580. The margin
    // has to be small enough that these still come through.
    chatSearch.mockResolvedValueOnce([[chatDoc, 0.358]]);
    librarySearch.mockResolvedValueOnce([[libDoc, 0.6607]]);
    const { retrieve } = await import("./retrieve.js");
    const out = await retrieve({ rewritten: "q", conversationId: "c1" } as never);
    expect(out.docs.map((d) => d.filename)).toEqual(["doc.pdf", "lib.pdf"]);
  });

  it("applies the floor to library noise but not to per-chat uploads", async () => {
    chatSearch.mockResolvedValueOnce([[chatDoc, 0.3]]);
    librarySearch.mockResolvedValueOnce([[libDoc, 0.3]]); // library noise -> dropped
    const { retrieve } = await import("./retrieve.js");
    const out = await retrieve({ rewritten: "q", conversationId: "c1" } as never);
    expect(out.docs.map((d) => d.filename)).toEqual(["doc.pdf"]);
  });

  it("returns nothing when the conversation has no upload and the library is noise", async () => {
    chatSearch.mockResolvedValueOnce([]);
    librarySearch.mockResolvedValueOnce([[libDoc, 0.3]]);
    const { retrieve } = await import("./retrieve.js");
    const out = await retrieve({ rewritten: "q", conversationId: "c1" } as never);
    expect(out.docs).toEqual([]);
  });

  it("still returns per-chat docs when the library search fails", async () => {
    chatSearch.mockResolvedValueOnce([[chatDoc, 0.6]]);
    librarySearch.mockRejectedValueOnce(new Error("no library collection"));
    const { retrieve } = await import("./retrieve.js");
    const out = await retrieve({ rewritten: "q", conversationId: "c1" } as never);
    expect(out.docs.map((d) => d.filename)).toEqual(["doc.pdf"]);
  });
});
