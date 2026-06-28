import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe("geminiRead", () => {
  it("posts the file to OpenRouter and returns the extracted text", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "extracted text" } }] }),
    });
    const { geminiRead } = await import("./models.js");
    const text = await geminiRead(Buffer.from("%PDF-1.4"), "application/pdf");
    expect(text).toBe("extracted text");
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("openrouter");
  });

  it("throws on a non-ok response", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500 });
    const { geminiRead } = await import("./models.js");
    await expect(geminiRead(Buffer.from("x"), "application/pdf")).rejects.toThrow();
  });
});
