import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { queryRag, ingestFile } from "./n8n-client.js";

describe("n8n-client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("queryRag posts to the query webhook and returns the parsed result", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: "Paris.",
        sources: [{ filename: "geo.pdf", chunkIndex: 0, text: "capital is Paris" }],
      }),
    });

    const result = await queryRag("conv-1", "What is the capital of France?");

    expect(result.answer).toBe("Paris.");
    expect(result.sources[0].filename).toBe("geo.pdf");
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("/webhook/rag-query");
    expect(JSON.parse(init.body)).toEqual({
      conversationId: "conv-1",
      question: "What is the capital of France?",
    });
  });

  it("queryRag throws on a non-ok response", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500 });
    await expect(queryRag("conv-1", "hi")).rejects.toThrow();
  });
});
