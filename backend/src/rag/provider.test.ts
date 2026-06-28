import { describe, it, expect, vi, beforeEach } from "vitest";

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
