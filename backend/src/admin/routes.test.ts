import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { buildTestApp, makeDbMock, TEST_USER_ID } from "../test/app-harness.js";

const dbMock = makeDbMock();
vi.mock("../db/index.js", () => ({ db: dbMock.db }));
vi.mock("../auth/middleware.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../auth/csrf.js", () => ({ requireCsrf: (_req: unknown, _res: unknown, next: () => void) => next(), CSRF_HEADER_NAME: "x-csrf-token" }));
vi.mock("../auth/password.js", () => ({ hashPassword: vi.fn(async () => "new-hash"), verifyPassword: vi.fn(async () => true) }));

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

describe("POST /admin/users", () => {
  it("creates a user and returns 201", async () => {
    dbMock.setResult([
      {
        id: "u2",
        email: "new@example.com",
        name: "New",
        isAdmin: false,
        disabledAt: null,
        createdAt: "t",
        lastLoginAt: null,
      },
    ]);
    const res = await request(app())
      .post("/admin/users")
      .send({ email: "new@example.com", name: "New", password: "StrongPass1!", isAdmin: false });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe("new@example.com");
  });

  it("rejects a weak password with 400", async () => {
    const res = await request(app())
      .post("/admin/users")
      .send({ email: "new@example.com", password: "weak" });
    expect(res.status).toBe(400);
  });

  it("returns 409 on a duplicate email", async () => {
    const insertSpy = dbMock.db.insert as ReturnType<typeof vi.fn>;
    insertSpy.mockImplementationOnce(() => {
      throw Object.assign(new Error("duplicate"), { code: "23505" });
    });
    const res = await request(app())
      .post("/admin/users")
      .send({ email: "dupe@example.com", password: "StrongPass1!" });
    expect(res.status).toBe(409);
  });
});

describe("PATCH /admin/users/:id/admin", () => {
  it("promotes a user to admin and returns 204", async () => {
    dbMock.setResult([{ id: "u9" }]); // update .returning row
    const res = await request(app())
      .patch("/admin/users/u9/admin")
      .send({ isAdmin: true });
    expect(res.status).toBe(204);
  });

  it("blocks demoting your own account with 409", async () => {
    const res = await request(app())
      .patch(`/admin/users/${TEST_USER_ID}/admin`)
      .send({ isAdmin: false });
    expect(res.status).toBe(409);
  });

  it("blocks demoting the last active admin with 409", async () => {
    dbMock.setResult([
      { id: "u9", email: "x", name: "X", isAdmin: true, disabledAt: null, activeAdminCount: 1 },
    ]);
    const res = await request(app())
      .patch("/admin/users/u9/admin")
      .send({ isAdmin: false });
    expect(res.status).toBe(409);
  });

  it("allows demoting when other active admins remain", async () => {
    dbMock.setResult([
      { id: "u9", email: "x", name: "X", isAdmin: true, disabledAt: null, activeAdminCount: 2 },
    ]);
    const res = await request(app())
      .patch("/admin/users/u9/admin")
      .send({ isAdmin: false });
    expect(res.status).toBe(204);
  });
});

describe("PATCH /admin/users/:id/disabled", () => {
  it("disables a user and stamps disabledAt", async () => {
    dbMock.setResult([
      { id: "u9", email: "x", name: "X", isAdmin: false, disabledAt: null, activeAdminCount: 2 },
    ]);
    const setSpy = dbMock.db.set as ReturnType<typeof vi.fn>;
    const res = await request(app())
      .patch("/admin/users/u9/disabled")
      .send({ disabled: true });
    expect(res.status).toBe(204);
    expect(setSpy.mock.calls[0][0].disabledAt).toBeInstanceOf(Date);
  });

  it("enables a user by clearing disabledAt", async () => {
    dbMock.setResult([
      { id: "u9", email: "x", name: "X", isAdmin: false, disabledAt: "t", activeAdminCount: 2 },
    ]);
    const setSpy = dbMock.db.set as ReturnType<typeof vi.fn>;
    const res = await request(app())
      .patch("/admin/users/u9/disabled")
      .send({ disabled: false });
    expect(res.status).toBe(204);
    expect(setSpy.mock.calls[0][0]).toEqual({ disabledAt: null });
  });

  it("blocks disabling your own account with 409", async () => {
    const res = await request(app())
      .patch(`/admin/users/${TEST_USER_ID}/disabled`)
      .send({ disabled: true });
    expect(res.status).toBe(409);
  });

  it("blocks disabling the last active admin with 409", async () => {
    dbMock.setResult([
      { id: "u9", email: "x", name: "X", isAdmin: true, disabledAt: null, activeAdminCount: 1 },
    ]);
    const res = await request(app())
      .patch("/admin/users/u9/disabled")
      .send({ disabled: true });
    expect(res.status).toBe(409);
  });
});

describe("POST /admin/users/:id/password", () => {
  it("resets the password and returns 204", async () => {
    dbMock.setResult([{ id: "u9" }]); // update .returning row
    const setSpy = dbMock.db.set as ReturnType<typeof vi.fn>;
    const res = await request(app())
      .post("/admin/users/u9/password")
      .send({ newPassword: "StrongPass1!" });
    expect(res.status).toBe(204);
    expect(setSpy).toHaveBeenCalledWith({ passwordHash: "new-hash" });
  });

  it("rejects a weak password with 400", async () => {
    const res = await request(app())
      .post("/admin/users/u9/password")
      .send({ newPassword: "weak" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the target user is missing", async () => {
    dbMock.setResult([]); // update .returning empty
    const res = await request(app())
      .post("/admin/users/ghost/password")
      .send({ newPassword: "StrongPass1!" });
    expect(res.status).toBe(404);
  });
});
