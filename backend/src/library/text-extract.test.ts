import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config.js", () => ({ config: { N8N_BASE_URL: "http://n8n:5678" } }));

const { extractText } = await import("./text-extract.js");

describe("extractText", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POSTs to the rag-read webhook and returns the text", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ text: "hello" }), { status: 200 }));
    const text = await extractText(Buffer.from("x"), "a.pdf", "application/pdf");
    expect(text).toBe("hello");
    expect(fetchMock.mock.calls[0][0]).toBe("http://n8n:5678/webhook/rag-read");
  });

  it("throws on a non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 502 }));
    await expect(extractText(Buffer.from("x"), "a.pdf", "application/pdf")).rejects.toThrow(/rag-read/);
  });
});
