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

  it("system prompt carries comparison-structure guidance and the grounding guardrail", async () => {
    const docs = [{ filename: "d.pdf", chunkIndex: 0, text: "ctx" }];
    const { generate } = await import("./generate.js");
    await generate({ question: "which is better, A or B?", docs } as never);
    const messages = (invoke.mock.calls[0] as unknown[])[0] as { role: string; content: string }[];
    const system = messages.find((m) => m.role === "system");
    expect(system).toBeDefined();
    expect(system!.content).toMatch(/only the provided context/i);
    expect(system!.content).toMatch(/Recommendation:/);
    expect(system!.content).toMatch(/table/i);
    expect(system!.content).toMatch(/do not invent|never invent/i);
  });

  it("system prompt carries brainstorming / idss-options guidance", async () => {
    const docs = [{ filename: "d.pdf", chunkIndex: 0, text: "ctx" }];
    const { generate } = await import("./generate.js");
    await generate({ question: "brainstorm some ideas", docs } as never);
    const messages = (invoke.mock.calls[0] as unknown[])[0] as { role: string; content: string }[];
    const system = messages.find((m) => m.role === "system");
    expect(system).toBeDefined();
    expect(system!.content).toMatch(/brainstorm/i);
    expect(system!.content).toMatch(/idss-options/);
    expect(system!.content).toMatch(/multiSelect/);
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
