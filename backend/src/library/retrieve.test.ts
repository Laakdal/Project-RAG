import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config.js", () => ({
  config: { OPENAI_API_KEY: "sk-test", GENERATE_MODEL: "gpt-4o-mini" },
}));

const search = vi.fn();
vi.mock("./vector-store.js", () => ({ search }));

const invoke = vi.fn();
vi.mock("@langchain/openai", () => ({
  ChatOpenAI: class {
    invoke = invoke;
  },
}));

const { searchLibrary, shouldSearchLibrary } = await import("./retrieve.js");

describe("searchLibrary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns hits above the score threshold as QuerySource, dropping weak ones", async () => {
    search.mockResolvedValue([
      { filename: "a.pdf", chunkIndex: 0, text: "strong", score: 0.9 },
      { filename: "b.pdf", chunkIndex: 1, text: "weak", score: 0.05 },
    ]);
    const docs = await searchLibrary("q");
    expect(docs).toEqual([{ filename: "a.pdf", chunkIndex: 0, text: "strong" }]);
  });

  it("includes hits at the exact inclusive threshold score", async () => {
    search.mockResolvedValue([
      { filename: "a.pdf", chunkIndex: 0, text: "strong", score: 0.9 },
      { filename: "c.pdf", chunkIndex: 2, text: "boundary", score: 0.2 },
      { filename: "b.pdf", chunkIndex: 1, text: "weak", score: 0.05 },
    ]);
    const docs = await searchLibrary("q");
    expect(docs).toEqual([
      { filename: "a.pdf", chunkIndex: 0, text: "strong" },
      { filename: "c.pdf", chunkIndex: 2, text: "boundary" },
    ]);
  });
});

describe("shouldSearchLibrary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true when the classifier says yes", async () => {
    invoke.mockResolvedValue({ content: "yes" });
    expect(await shouldSearchLibrary("what does the SOP say?")).toBe(true);
  });

  it("returns false when the classifier says no", async () => {
    invoke.mockResolvedValue({ content: "no" });
    expect(await shouldSearchLibrary("write me a poem")).toBe(false);
  });

  it("returns false early when OPENAI_API_KEY is missing", async () => {
    vi.resetModules();
    const invokeNoKey = vi.fn();
    vi.doMock("../config.js", () => ({
      config: { GENERATE_MODEL: "gpt-4o-mini" },
    }));
    vi.doMock("./vector-store.js", () => ({ search }));
    vi.doMock("@langchain/openai", () => ({
      ChatOpenAI: class {
        invoke = invokeNoKey;
      },
    }));
    const mod = await import("./retrieve.js");
    expect(await mod.shouldSearchLibrary("anything")).toBe(false);
    expect(invokeNoKey).not.toHaveBeenCalled();
  });
});
