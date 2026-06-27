import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { buildTestApp, makeDbMock } from "../test/app-harness.js";

const dbMock = makeDbMock();
vi.mock("../db/index.js", () => ({ db: dbMock.db }));

const { requireAdmin } = await import("./middleware.js");

function app(authed = true) {
  return buildTestApp((a) => {
    a.get("/admin-only", requireAdmin, (_req, res) => {
      res.json({ ok: true });
    });
  }, authed);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireAdmin", () => {
  it("calls next for an admin user", async () => {
    dbMock.setResult([{ isAdmin: true }]);
    const res = await request(app()).get("/admin-only");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("returns 403 for a non-admin user", async () => {
    dbMock.setResult([{ isAdmin: false }]);
    const res = await request(app()).get("/admin-only");
    expect(res.status).toBe(403);
  });

  it("returns 403 when the session user no longer exists", async () => {
    dbMock.setResult([]);
    const res = await request(app()).get("/admin-only");
    expect(res.status).toBe(403);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app(false)).get("/admin-only");
    expect(res.status).toBe(401);
  });

  it("returns 403 for a disabled admin", async () => {
    dbMock.setResult([{ isAdmin: true, disabledAt: new Date().toISOString() }]);
    const res = await request(app()).get("/admin-only");
    expect(res.status).toBe(403);
  });
});
