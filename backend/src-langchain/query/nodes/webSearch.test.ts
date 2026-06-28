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
});
