import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn(async () => ({ content: "Today's weather is sunny." }));
const makeChatModel = vi.fn(() => ({ invoke }));
vi.mock("../../shared/models.js", () => ({ makeChatModel }));

describe("webSearch node", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the web result as a labelled context doc for generate", async () => {
    const { webSearch } = await import("./webSearch.js");
    const out = await webSearch({ question: "weather today?" } as never);
    expect(out.docs).toHaveLength(1);
    expect(out.docs[0].filename).toBe("Web search");
    expect(out.docs[0].text).toContain("sunny");
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
    expect(out.docs[0].text).toBe("hello world");
  });

  it("returns no docs when the web result is empty (generate then uses general knowledge)", async () => {
    invoke.mockResolvedValueOnce({ content: "" });
    const { webSearch } = await import("./webSearch.js");
    const out = await webSearch({ question: "q?" } as never);
    expect(out.docs).toEqual([]);
  });

  it("returns no docs when the web LLM errors", async () => {
    invoke.mockRejectedValueOnce(new Error("web llm down"));
    const { webSearch } = await import("./webSearch.js");
    const out = await webSearch({ question: "q?" } as never);
    expect(out.docs).toEqual([]);
  });
});
