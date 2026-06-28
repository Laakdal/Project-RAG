import { describe, it, expect, vi, beforeEach } from "vitest";

const geminiRead = vi.fn(async () => "doc text");
vi.mock("../shared/models.js", () => ({ geminiRead }));

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("readDocument", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads a PDF directly without conversion", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { readDocument } = await import("./read.js");
    const text = await readDocument(Buffer.from("%PDF"), "application/pdf");
    expect(text).toBe("doc text");
    expect(fetch).not.toHaveBeenCalled(); // no Gotenberg hop for PDFs
    vi.unstubAllGlobals();
  });

  it("converts DOCX via Gotenberg before reading", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })));
    const { readDocument } = await import("./read.js");
    const text = await readDocument(Buffer.from("PK"), DOCX);
    expect(text).toBe("doc text");
    expect(fetch).toHaveBeenCalled(); // Gotenberg was hit
    // The bytes passed to gemini are the converted PDF, declared as application/pdf.
    expect((geminiRead.mock.calls[0] as unknown[])[1]).toBe("application/pdf");
    vi.unstubAllGlobals();
  });
});
