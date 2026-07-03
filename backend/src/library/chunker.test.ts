import { describe, it, expect } from "vitest";
import { chunkText } from "./chunker.js";

describe("chunkText", () => {
  it("returns [] for empty or whitespace input", async () => {
    expect(await chunkText("")).toEqual([]);
    expect(await chunkText("   \n  ")).toEqual([]);
  });

  it("returns a single chunk for short text", async () => {
    const chunks = await chunkText("hello world");
    expect(chunks).toEqual(["hello world"]);
  });

  it("splits long text into multiple chunks", async () => {
    const long = "word ".repeat(600); // ~3000 chars > 1000
    const chunks = await chunkText(long);
    expect(chunks.length).toBeGreaterThan(1);
  });
});
