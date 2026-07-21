import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn(async () => ({ content: '{"useDrive": true, "webSearch": false}' }));
vi.mock("../../shared/models.js", () => ({ makeIntentModel: () => ({ invoke }) }));

// The node also checks whether the conversation has an upload, so retrieval is
// not skipped for questions about an attached file.
const hasAttachments = vi.fn(async () => false);
vi.mock("../../shared/attachments.js", () => ({ conversationHasAttachments: hasAttachments }));

describe("intent node", () => {
  beforeEach(() => vi.clearAllMocks());

  it("parses useDrive and maps webSearch -> needsWeb", async () => {
    const { intent } = await import("./intent.js");
    const out = await intent({ question: "apa isi SOP IT" } as never);
    expect(out).toEqual({ useDrive: true, needsWeb: false, hasAttachments: false });
  });

  it("routes a public question to the web", async () => {
    invoke.mockResolvedValueOnce({ content: '{"useDrive": false, "webSearch": true}' });
    const { intent } = await import("./intent.js");
    const out = await intent({ question: "apa itu css" } as never);
    expect(out).toEqual({ useDrive: false, needsWeb: true, hasAttachments: false });
  });

  it("routes a creative task to neither (general knowledge)", async () => {
    invoke.mockResolvedValueOnce({ content: 'Sure: {"useDrive": false, "webSearch": false}' });
    const { intent } = await import("./intent.js");
    const out = await intent({ question: "buatkan flowchart login" } as never);
    expect(out).toEqual({ useDrive: false, needsWeb: false, hasAttachments: false });
  });

  it("defaults to the user's documents when the classifier errors", async () => {
    invoke.mockRejectedValueOnce(new Error("classifier down"));
    const { intent } = await import("./intent.js");
    const out = await intent({ question: "PPAB 7 juli 2025" } as never);
    expect(out).toEqual({ useDrive: true, needsWeb: false, hasAttachments: false });
  });

  it("reports an upload in the conversation even when the classifier says neither", async () => {
    // "gambar apa ini" is classified false/false — correct in n8n, where the
    // file was inline, but here the graph needs to know an upload exists so it
    // still routes through retrieval.
    invoke.mockResolvedValueOnce({ content: '{"useDrive": false, "webSearch": false}' });
    hasAttachments.mockResolvedValueOnce(true);
    const { intent } = await import("./intent.js");
    const out = await intent({ question: "gambar apa ini", conversationId: "c1" } as never);
    expect(out).toEqual({ useDrive: false, needsWeb: false, hasAttachments: true });
  });

  it("still reports the upload when the classifier errors", async () => {
    invoke.mockRejectedValueOnce(new Error("classifier down"));
    hasAttachments.mockResolvedValueOnce(true);
    const { intent } = await import("./intent.js");
    const out = await intent({ question: "apa ini", conversationId: "c1" } as never);
    expect(out).toEqual({ useDrive: true, needsWeb: false, hasAttachments: true });
  });
});
