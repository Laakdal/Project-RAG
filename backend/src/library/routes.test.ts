import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { buildTestApp } from "../test/app-harness.js";

vi.mock("../auth/middleware.js", () => ({
  requireAuth: (_q: unknown, _s: unknown, n: () => void) => n(),
  requireAdmin: (_q: unknown, _s: unknown, n: () => void) => n(),
}));
vi.mock("../auth/csrf.js", () => ({
  requireCsrf: (_q: unknown, _s: unknown, n: () => void) => n(),
  CSRF_HEADER_NAME: "x-csrf-token",
}));
const runSync = vi.fn(async () => ({ added: 2, updated: 0, deleted: 1, skipped: 5, failed: 0, failures: [] }));
vi.mock("./sync.js", () => ({ runSync }));
vi.mock("./repo.js", () => ({ summary: vi.fn(async () => ({ total: 8, failed: 0, lastIndexedAt: "t" })) }));

const { libraryRouter } = await import("./routes.js");
const app = () => buildTestApp((a) => a.use("/library", libraryRouter));

describe("library routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("POST /library/sync runs a sync and returns the summary", async () => {
    const res = await request(app()).post("/library/sync").send({});
    expect(res.status).toBe(200);
    expect(res.body.added).toBe(2);
    expect(runSync).toHaveBeenCalled();
  });

  it("GET /library/status returns counts", async () => {
    const res = await request(app()).get("/library/status");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(8);
  });
});
