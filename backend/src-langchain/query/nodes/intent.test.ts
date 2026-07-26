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
    expect(out).toEqual({ useDrive: true, needsWeb: false, needsReasoning: false, needsOptions: false, hasAttachments: false });
  });

  it("routes a public question to the web", async () => {
    invoke.mockResolvedValueOnce({ content: '{"useDrive": false, "webSearch": true, "needsReasoning": false}' });
    const { intent } = await import("./intent.js");
    const out = await intent({ question: "apa itu css" } as never);
    expect(out).toEqual({ useDrive: false, needsWeb: true, needsReasoning: false, needsOptions: false, hasAttachments: false });
  });

  it("parses needsReasoning for a comparison / decision-support question", async () => {
    invoke.mockResolvedValueOnce({ content: '{"useDrive": true, "webSearch": false, "needsReasoning": true}' });
    const { intent } = await import("./intent.js");
    const out = await intent({ question: "mana yang lebih baik, paket A atau paket B" } as never);
    expect(out).toEqual({ useDrive: true, needsWeb: false, needsReasoning: true, needsOptions: false, hasAttachments: false });
  });

  it("routes a creative task to neither (general knowledge)", async () => {
    invoke.mockResolvedValueOnce({ content: 'Sure: {"useDrive": false, "webSearch": false, "needsReasoning": false}' });
    const { intent } = await import("./intent.js");
    const out = await intent({ question: "buatkan flowchart login" } as never);
    expect(out).toEqual({ useDrive: false, needsWeb: false, needsReasoning: false, needsOptions: false, hasAttachments: false });
  });

  it("parses needsOptions for a question that warrants decision support", async () => {
    invoke.mockResolvedValueOnce({
      content: '{"useDrive": true, "webSearch": false, "needsReasoning": true, "needsOptions": true}',
    });
    const { intent } = await import("./intent.js");
    const out = await intent({ question: "bagaimana pendekatan terbaik untuk ini" } as never);
    expect(out.needsOptions).toBe(true);
  });

  it("defaults needsOptions to false when the classifier omits it", async () => {
    // Missing or malformed -> today's behaviour (no cards), never cards on every
    // turn.
    invoke.mockResolvedValueOnce({ content: '{"useDrive": true, "webSearch": false}' });
    const { intent } = await import("./intent.js");
    const out = await intent({ question: "berapa total biayanya" } as never);
    expect(out.needsOptions).toBe(false);
  });

  it("tells the classifier when options are warranted and when to suppress them", async () => {
    const { intent } = await import("./intent.js");
    await intent({ question: "q" } as never);
    const messages = (invoke.mock.calls[0] as unknown[])[0] as { content: string }[];
    const prompt = messages[0].content;
    expect(prompt).toMatch(/needsOptions/);
    // The three situations that warrant cards.
    expect(prompt).toMatch(/competing|alternatives/i);
    expect(prompt).toMatch(/several (valid )?(ways|paths)|more than one/i);
    expect(prompt).toMatch(/ambiguous|which reading/i);
    // And the suppression rule that keeps an eager policy tolerable.
    expect(prompt).toMatch(/already (offered|shown)|picking one of|responding to/i);
  });

  it("defaults to the user's documents (and cheap model) when the classifier errors", async () => {
    invoke.mockRejectedValueOnce(new Error("classifier down"));
    const { intent } = await import("./intent.js");
    const out = await intent({ question: "PPAB 7 juli 2025" } as never);
    expect(out).toEqual({ useDrive: true, needsWeb: false, needsReasoning: false, needsOptions: false, hasAttachments: false });
  });

  it("reports an upload in the conversation even when the classifier says neither", async () => {
    // "gambar apa ini" is classified false/false — correct in n8n, where the
    // file was inline, but here the graph needs to know an upload exists so it
    // still routes through retrieval.
    invoke.mockResolvedValueOnce({ content: '{"useDrive": false, "webSearch": false, "needsReasoning": false}' });
    hasAttachments.mockResolvedValueOnce(true);
    const { intent } = await import("./intent.js");
    const out = await intent({ question: "gambar apa ini", conversationId: "c1" } as never);
    expect(out).toEqual({ useDrive: false, needsWeb: false, needsReasoning: false, needsOptions: false, hasAttachments: true });
  });

  it("still reports the upload when the classifier errors", async () => {
    invoke.mockRejectedValueOnce(new Error("classifier down"));
    hasAttachments.mockResolvedValueOnce(true);
    const { intent } = await import("./intent.js");
    const out = await intent({ question: "apa ini", conversationId: "c1" } as never);
    expect(out).toEqual({ useDrive: true, needsWeb: false, needsReasoning: false, needsOptions: false, hasAttachments: true });
  });
});
