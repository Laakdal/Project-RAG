import { describe, it, expect } from "vitest";
import { titleFromQuestion } from "./title-generator.js";

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
});
