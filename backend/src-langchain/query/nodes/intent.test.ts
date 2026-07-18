import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn(async () => ({ content: '{"useDrive": true, "webSearch": false}' }));
vi.mock("../../shared/models.js", () => ({ makeIntentModel: () => ({ invoke }) }));

describe("intent node", () => {
  beforeEach(() => vi.clearAllMocks());

  it("parses useDrive and maps webSearch -> needsWeb", async () => {
    const { intent } = await import("./intent.js");
    const out = await intent({ question: "apa isi SOP IT" } as never);
    expect(out).toEqual({ useDrive: true, needsWeb: false });
  });

  it("routes a public question to the web", async () => {
    invoke.mockResolvedValueOnce({ content: '{"useDrive": false, "webSearch": true}' });
    const { intent } = await import("./intent.js");
    const out = await intent({ question: "apa itu css" } as never);
    expect(out).toEqual({ useDrive: false, needsWeb: true });
  });

  it("routes a creative task to neither (general knowledge)", async () => {
    invoke.mockResolvedValueOnce({ content: 'Sure: {"useDrive": false, "webSearch": false}' });
    const { intent } = await import("./intent.js");
    const out = await intent({ question: "buatkan flowchart login" } as never);
    expect(out).toEqual({ useDrive: false, needsWeb: false });
  });

  it("defaults to the user's documents when the classifier errors", async () => {
    invoke.mockRejectedValueOnce(new Error("classifier down"));
    const { intent } = await import("./intent.js");
    const out = await intent({ question: "PPAB 7 juli 2025" } as never);
    expect(out).toEqual({ useDrive: true, needsWeb: false });
  });
});
