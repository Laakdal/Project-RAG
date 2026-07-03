import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { buildTestApp } from "../test/app-harness.js";

vi.mock("../auth/middleware.js", () => ({
  requireAuth: (_q: unknown, _s: unknown, n: () => void) => n(),
  requireAdmin: (_q: unknown, _s: unknown, n: () => void) => n(),
}));
vi.mock("./repo.js", () => ({ summary: vi.fn(async () => ({ total: 8, failed: 0, lastIndexedAt: "t" })) }));

const { libraryRouter } = await import("./routes.js");
const app = () => buildTestApp((a) => a.use("/library", libraryRouter));

describe("library routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET /library/status returns counts", async () => {
    const res = await request(app()).get("/library/status");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(8);
  });
});
