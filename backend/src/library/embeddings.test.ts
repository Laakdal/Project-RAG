import { describe, it, expect, vi } from "vitest";

vi.mock("../config.js", () => ({
  config: { OPENAI_API_KEY: "sk-test", EMBED_MODEL: "text-embedding-3-small" },
}));

const { makeEmbeddings } = await import("./embeddings.js");

describe("makeEmbeddings", () => {
  it("builds an embeddings client using the configured model", () => {
    const emb = makeEmbeddings();
    expect(emb.model).toBe("text-embedding-3-small");
  });
});

describe("makeEmbeddings without a key", () => {
  it("throws a clear error", async () => {
    vi.resetModules();
    vi.doMock("../config.js", () => ({ config: { EMBED_MODEL: "text-embedding-3-small" } }));
    const mod = await import("./embeddings.js");
    expect(() => mod.makeEmbeddings()).toThrow(/OPENAI_API_KEY/);
  });
});
