import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn(async () => ({ content: "What is the second budget item?" }));
vi.mock("../../shared/models.js", () => ({ makeChatModel: () => ({ invoke }) }));

describe("rewrite node", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the question unchanged when there is no history", async () => {
    const { rewrite } = await import("./rewrite.js");
    const out = await rewrite({ question: "hi", history: [] } as never);
    expect(out.rewritten).toBe("hi");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rewrites a follow-up using history", async () => {
    const { rewrite } = await import("./rewrite.js");
    const out = await rewrite({
      question: "what about the second one?",
      history: [{ role: "user", content: "list the budget items" }],
    } as never);
    expect(out.rewritten).toContain("second budget item");
    expect(invoke).toHaveBeenCalled();
  });

  it("falls back to the original question when the LLM errors", async () => {
    invoke.mockRejectedValueOnce(new Error("llm down"));
    const { rewrite } = await import("./rewrite.js");
    const out = await rewrite({
      question: "original question",
      history: [{ role: "user", content: "some prior turn" }],
    } as never);
    expect(out.rewritten).toBe("original question");
  });
});
