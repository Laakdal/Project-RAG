import { describe, it, expect } from "vitest";
import { extractText } from "./content.js";

describe("extractText", () => {
  it("returns a string as-is", () => {
    expect(extractText("hello world")).toBe("hello world");
  });

  it("joins text fields from an array of content blocks", () => {
    expect(
      extractText([{ type: "text", text: "hello" }, { type: "text", text: " world" }]),
    ).toBe("hello world");
  });

  it("handles a mixed array with bare strings and blocks", () => {
    expect(extractText(["foo", { type: "text", text: "bar" }])).toBe("foobar");
  });

  it("returns empty string for a non-string/non-array value", () => {
    expect(extractText(null)).toBe("");
    expect(extractText(42)).toBe("");
    expect(extractText(undefined)).toBe("");
  });

  it("returns empty string for a block with no text property", () => {
    expect(extractText([{ type: "image_url", image_url: {} }])).toBe("");
  });
});
