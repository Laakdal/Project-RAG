import { describe, it, expect, vi, beforeEach } from "vitest";

const ingest = vi.fn(async () => ({ status: "ok", chunkCount: 4 }));
const runQuery = vi.fn(async () => ({ answer: "A", sources: [], title: "T" }));
vi.mock("./ingest/pipeline.js", () => ({ ingest }));
vi.mock("./query/graph.js", () => ({ runQuery }));
vi.mock("./shared/models.js", () => ({ requireLanggraphEnv: vi.fn() }));

describe("langgraphProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ingestFile delegates to the pipeline", async () => {
    const { langgraphProvider } = await import("./index.js");
    const r = await langgraphProvider.ingestFile("c1", "d.pdf", Buffer.from("x"), "application/pdf");
    expect(r).toEqual({ status: "ok", chunkCount: 4 });
    expect(ingest).toHaveBeenCalledWith("c1", "d.pdf", expect.any(Buffer), "application/pdf");
  });

  it("queryRag delegates to the graph", async () => {
    const { langgraphProvider } = await import("./index.js");
    const r = await langgraphProvider.queryRag("c1", "q", [], true);
    expect(r.answer).toBe("A");
    expect(runQuery).toHaveBeenCalledWith("c1", "q", [], true);
  });
});
