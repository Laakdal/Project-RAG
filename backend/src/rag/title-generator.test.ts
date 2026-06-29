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
  it("strips a leading list marker so numbered prompts aren't titled just '1'", () => {
    expect(
      titleFromQuestion("1. User membuka halaman login. 2. User memasukkan username."),
    ).toBe("User membuka halaman login");
  });
});
