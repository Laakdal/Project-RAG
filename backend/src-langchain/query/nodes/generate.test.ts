import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn(async () => ({ content: "The answer is 42." }));
const makeAnswerModel = vi.fn(() => ({ invoke }));
vi.mock("../../shared/models.js", () => ({ makeAnswerModel }));

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
    const system = messages.find((m) => m.role === "user");
    expect(system).toBeDefined();
    expect(system!.content).toMatch(/ground your answer in it/i);
    expect(system!.content).toMatch(/Recommendation:/);
    expect(system!.content).toMatch(/table/i);
    expect(system!.content).toMatch(/do not invent|never invent/i);
  });

  it("system prompt carries Mermaid diagram guidance", async () => {
    const docs = [{ filename: "d.pdf", chunkIndex: 0, text: "ctx" }];
    const { generate } = await import("./generate.js");
    await generate({ question: "draw a flowchart", docs } as never);
    const messages = (invoke.mock.calls[0] as unknown[])[0] as { role: string; content: string }[];
    const system = messages.find((m) => m.role === "user");
    expect(system!.content).toMatch(/mermaid/i);
    expect(system!.content).toMatch(/flowchart/);
  });

  it("injects conversation history into the user message", async () => {
    const docs = [{ filename: "d.pdf", chunkIndex: 0, text: "ctx" }];
    const history = [
      { role: "user", content: "who is on the trip?" },
      { role: "assistant", content: "Budi and Ani." },
    ];
    const { generate } = await import("./generate.js");
    await generate({ question: "and what were the dates?", docs, history } as never);
    const messages = (invoke.mock.calls[0] as unknown[])[0] as { role: string; content: string }[];
    const user = messages.find((m) => m.role === "user");
    expect(user!.content).toMatch(/User: who is on the trip\?/);
    expect(user!.content).toMatch(/Assistant: Budi and Ani\./);
    expect(user!.content).toMatch(/Conversation so far/);
  });

  it("system prompt carries brainstorming / idss-options guidance", async () => {
    const docs = [{ filename: "d.pdf", chunkIndex: 0, text: "ctx" }];
    const { generate } = await import("./generate.js");
    await generate({ question: "brainstorm some ideas", docs } as never);
    const messages = (invoke.mock.calls[0] as unknown[])[0] as { role: string; content: string }[];
    const system = messages.find((m) => m.role === "user");
    expect(system).toBeDefined();
    expect(system!.content).toMatch(/brainstorm/i);
    expect(system!.content).toMatch(/idss-options/);
    expect(system!.content).toMatch(/multiSelect/);
  });

  it("selects the answer model by needsReasoning (routes pro vs flash downstream)", async () => {
    const docs = [{ filename: "d.pdf", chunkIndex: 0, text: "ctx" }];
    const { generate } = await import("./generate.js");
    await generate({ question: "compare A and B", docs, needsReasoning: true } as never);
    expect(makeAnswerModel).toHaveBeenLastCalledWith(true);
    await generate({ question: "what is x", docs, needsReasoning: false } as never);
    expect(makeAnswerModel).toHaveBeenLastCalledWith(false);
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
