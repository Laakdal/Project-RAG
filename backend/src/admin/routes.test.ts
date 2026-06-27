import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { buildTestApp, makeDbMock } from "../test/app-harness.js";

const dbMock = makeDbMock();
vi.mock("../db/index.js", () => ({ db: dbMock.db }));
vi.mock("../auth/middleware.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const { adminRouter } = await import("./routes.js");

function app() {
  return buildTestApp((a) => a.use("/admin", adminRouter));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /admin/users", () => {
  it("returns the user list", async () => {
    dbMock.setResult([
      {
        id: "u1",
        email: "a@example.com",
        name: "A",
        isAdmin: true,
        disabledAt: null,
        createdAt: "t",
        lastLoginAt: null,
        conversationCount: 3,
      },
    ]);
    const res = await request(app()).get("/admin/users");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].conversationCount).toBe(3);
    expect(res.body[0]).not.toHaveProperty("passwordHash");
  });
});

describe("GET /admin/stats", () => {
  it("returns aggregate counts", async () => {
    // The shared db mock resolves every aggregate select to this one row, so
    // each count field reads from the same object. We assert the response shape
    // and that values are wired through, not cross-table independence.
    dbMock.setResult([{ total: 5, admins: 2, disabled: 1, failed: 4 }]);
    const res = await request(app()).get("/admin/stats");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      users: 5,
      admins: 2,
      disabledUsers: 1,
      ingestionFailures: 4,
    });
    expect(res.body).toHaveProperty("conversations");
    expect(res.body).toHaveProperty("messages");
    expect(res.body).toHaveProperty("attachments");
  });
});
