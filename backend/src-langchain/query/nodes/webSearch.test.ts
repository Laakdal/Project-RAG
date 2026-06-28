import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn(async () => ({ content: "Today's weather is sunny." }));
const makeChatModel = vi.fn(() => ({ invoke }));
vi.mock("../../shared/models.js", () => ({ makeChatModel }));

describe("webSearch node", () => {
  beforeEach(() => vi.clearAllMocks());

  it("answers via the web-search model with empty sources", async () => {
    const { webSearch } = await import("./webSearch.js");
    const out = await webSearch({ question: "weather today?" } as never);
    expect(out.answer).toContain("sunny");
    expect(out.sources).toEqual([]);
    expect(makeChatModel).toHaveBeenCalledWith({ webSearch: true });
  });

  it("prefers the rewritten query over the original question when provided", async () => {
    const { webSearch } = await import("./webSearch.js");
    await webSearch({ question: "it?", rewritten: "What is the capital of France?" } as never);
    const callArg = (invoke.mock.calls as unknown as { role: string; content: string }[][][])[0][0];
    expect(callArg[0].content).toBe("What is the capital of France?");
  });

  it("extracts text from an array of content blocks", async () => {
    invoke.mockResolvedValueOnce({ content: [{ type: "text", text: "hello world" }] as unknown as string });
    const { webSearch } = await import("./webSearch.js");
    const out = await webSearch({ question: "q?" } as never);
    expect(out.answer).toBe("hello world");
    expect(out.sources).toEqual([]);
  });

  it("delegates to generate (docs-based answer) when the web LLM errors and docs exist", async () => {
    invoke
      .mockRejectedValueOnce(new Error("web llm down"))
      .mockResolvedValueOnce({ content: "Based on the docs: 42 is the answer." });
    const docs = [{ filename: "d.pdf", chunkIndex: 0, text: "42 is the answer" }];
    const { webSearch } = await import("./webSearch.js");
    const out = await webSearch({ question: "what is the answer?", docs } as never);
    expect(out.answer).toContain("42 is the answer");
    expect(out.sources).toEqual(docs);
  });

  it("returns FALLBACK_ANSWER when the web LLM errors and no docs exist", async () => {
    invoke.mockRejectedValueOnce(new Error("web llm down"));
    const { webSearch } = await import("./webSearch.js");
    const { FALLBACK_ANSWER } = await import("./generate.js");
    const out = await webSearch({ question: "q?", docs: [] } as never);
    expect(out.answer).toBe(FALLBACK_ANSWER);
    expect(out.sources).toEqual([]);
  });
});
