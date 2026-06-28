import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn(async () => ({ content: "Budget overview" }));
vi.mock("../../shared/models.js", () => ({ makeChatModel: () => ({ invoke }) }));

describe("title node", () => {
  beforeEach(() => vi.clearAllMocks());
  it("skips when generateTitle is false", async () => {
    const { title } = await import("./title.js");
    const out = await title({ question: "q", generateTitle: false } as never);
    expect(out).toEqual({});
    expect(invoke).not.toHaveBeenCalled();
  });
  it("returns a short title when asked", async () => {
    const { title } = await import("./title.js");
    const out = await title({ question: "explain the budget", generateTitle: true } as never);
    expect(out.title).toBe("Budget overview");
  });
});
