import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../settings/service.js", () => ({
  getSetting: (k: string) =>
    k === "OPENAI_API_KEY" ? "sk-test" : k === "GENERATE_MODEL" ? "gpt-4o-mini" : undefined,
}));
vi.mock("../config.js", () => ({
  config: { OPENAI_API_KEY: "sk-test", GENERATE_MODEL: "gpt-4o-mini" },
}));

const invoke = vi.fn();
vi.mock("@langchain/openai", () => ({
  ChatOpenAI: class {
    invoke = invoke;
  },
}));

import { titleFromQuestion, summarizeTitle } from "./title-generator.js";

describe("titleFromQuestion", () => {
  it("takes the first sentence", () => {
    expect(titleFromQuestion("Apa isi dokumen ini? Tolong jelaskan.")).toBe("Apa isi dokumen ini");
  });
  it("truncates very long single sentences to <= 60 chars", () => {
    const long = "a".repeat(200);
    expect(titleFromQuestion(long).length).toBeLessThanOrEqual(60);
  });
  it("falls back to 'New chat' on empty input", () => {
    expect(titleFromQuestion("   ")).toBe("New chat");
  });
  it("strips a leading list marker so numbered prompts aren't titled just '1'", () => {
    expect(
      titleFromQuestion("1. User membuka halaman login. 2. User memasukkan username."),
    ).toBe("User membuka halaman login");
  });
});

describe("summarizeTitle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the model's title, stripped of surrounding quotes and trailing punctuation", async () => {
    invoke.mockResolvedValue({ content: '"EPrT Certificate Summary."' });
    expect(await summarizeTitle("isi pdf ini apa", "It is an EPrT certificate")).toBe(
      "EPrT Certificate Summary",
    );
  });

  it("returns null on model error so the caller falls back to the heuristic", async () => {
    invoke.mockRejectedValue(new Error("boom"));
    expect(await summarizeTitle("q")).toBeNull();
  });

  it("returns null when the model gives an empty title", async () => {
    invoke.mockResolvedValue({ content: "  " });
    expect(await summarizeTitle("q")).toBeNull();
  });
});
