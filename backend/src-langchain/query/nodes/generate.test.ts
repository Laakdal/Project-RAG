import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn(async () => ({ content: "The answer is 42." }));
vi.mock("../../shared/models.js", () => ({ makeChatModel: () => ({ invoke }) }));

describe("generate node", () => {
  beforeEach(() => vi.clearAllMocks());

  it("answers from docs and returns them as sources", async () => {
    const docs = [{ filename: "d.pdf", chunkIndex: 0, text: "42 is the answer" }];
    const { generate } = await import("./generate.js");
    const out = await generate({ question: "answer?", docs } as never);
    expect(out.answer).toBe("The answer is 42.");
    expect(out.sources).toEqual(docs);
  });

  it("extracts text from an array of content blocks", async () => {
    invoke.mockResolvedValueOnce({ content: [{ type: "text", text: "hello world" }] as unknown as string });
    const docs = [{ filename: "d.pdf", chunkIndex: 0, text: "some context" }];
    const { generate } = await import("./generate.js");
    const out = await generate({ question: "q?", docs } as never);
    expect(out.answer).toBe("hello world");
  });

  it("returns FALLBACK_ANSWER and empty sources when the LLM errors", async () => {
    invoke.mockRejectedValueOnce(new Error("llm down"));
    const docs = [{ filename: "d.pdf", chunkIndex: 0, text: "context" }];
    const { generate, FALLBACK_ANSWER } = await import("./generate.js");
    const out = await generate({ question: "q?", docs } as never);
    expect(out.answer).toBe(FALLBACK_ANSWER);
    expect(out.sources).toEqual([]);
  });
});
