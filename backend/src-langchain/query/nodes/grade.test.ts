import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("../../shared/models.js", () => ({ makeChatModel: () => ({ invoke }) }));

describe("grade node", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is not relevant when there are no docs (no LLM call)", async () => {
    const { grade } = await import("./grade.js");
    const out = await grade({ question: "q", docs: [] } as never);
    expect(out.relevant).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("is relevant when the model answers yes", async () => {
    invoke.mockResolvedValueOnce({ content: "yes" });
    const { grade } = await import("./grade.js");
    const out = await grade({ question: "q", docs: [{ filename: "d", chunkIndex: 0, text: "t" }] } as never);
    expect(out.relevant).toBe(true);
  });

  it("degrades to not-relevant when the model errors", async () => {
    invoke.mockRejectedValueOnce(new Error("llm down"));
    const { grade } = await import("./grade.js");
    const out = await grade({ question: "q", docs: [{ filename: "d", chunkIndex: 0, text: "t" }] } as never);
    expect(out.relevant).toBe(false);
  });
});
