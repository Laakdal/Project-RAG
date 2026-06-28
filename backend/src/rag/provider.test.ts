import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The n8n implementation is mocked; the langgraph module is mocked so the seam
// can be tested without loading LangChain. Selection is driven by config, which
// reads process.env at import time — so set it before importing provider.ts.
vi.mock("./n8n-client.js", () => ({
  queryRag: vi.fn(async () => ({ answer: "n8n-answer", sources: [] })),
  ingestFile: vi.fn(async () => ({ status: "ok", chunkCount: 1 })),
}));

const lgQuery = vi.fn(async () => ({ answer: "lg-answer", sources: [] }));
const lgIngest = vi.fn(async () => ({ status: "ok", chunkCount: 2 }));
vi.mock("../../src-langchain/index.js", () => ({
  langgraphProvider: { queryRag: lgQuery, ingestFile: lgIngest },
}));

describe("rag provider seam", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes to n8n by default", async () => {
    const provider = await import("./provider.js");
    const r = await provider.queryRag("c1", "q", [], false);
    expect(r.answer).toBe("n8n-answer");
    expect(lgQuery).not.toHaveBeenCalled();
  });
});

describe("rag provider seam — langgraph dispatch", () => {
  const originalProvider = process.env.RAG_PROVIDER;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.RAG_PROVIDER = "langgraph";
  });

  afterEach(() => {
    if (originalProvider === undefined) {
      delete process.env.RAG_PROVIDER;
    } else {
      process.env.RAG_PROVIDER = originalProvider;
    }
    vi.resetModules();
  });

  it("routes queryRag to the langgraph provider when RAG_PROVIDER=langgraph", async () => {
    const provider = await import("./provider.js");
    const r = await provider.queryRag("c1", "q", [], false);
    expect(r.answer).toBe("lg-answer");
    expect(lgQuery).toHaveBeenCalledWith("c1", "q", [], false);
  });

  it("routes ingestFile to the langgraph provider when RAG_PROVIDER=langgraph", async () => {
    const provider = await import("./provider.js");
    const r = await provider.ingestFile("c1", "file.pdf", Buffer.from("x"), "application/pdf");
    expect(r.chunkCount).toBe(2);
    expect(lgIngest).toHaveBeenCalledWith("c1", "file.pdf", expect.any(Buffer), "application/pdf");
  });
});
