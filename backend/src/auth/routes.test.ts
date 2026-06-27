import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { buildTestApp, makeDbMock, TEST_USER_ID } from "../test/app-harness.js";

const dbMock = makeDbMock();
vi.mock("../db/index.js", () => ({ db: dbMock.db }));
vi.mock("./csrf.js", () => ({
  requireCsrf: (_req: unknown, _res: unknown, next: () => void) => next(),
  issueCsrfToken: () => "test-csrf",
  CSRF_HEADER_NAME: "x-csrf-token",
}));
vi.mock("./password.js", () => ({
  hashPassword: vi.fn(async () => "new-hash"),
  verifyPassword: vi.fn(async () => true),
}));

import { verifyPassword } from "./password.js";

const authRouter = (await import("./routes.js")).default;

function app(authed = true) {
  return buildTestApp((a) => a.use("/auth", authRouter), authed);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("login disabled-account check", () => {
  it("rejects a disabled user with 403 even when the password is correct", async () => {
    // Valid credentials (verifyPassword mocked true) but the account is disabled.
    dbMock.setResult([
      {
        id: TEST_USER_ID,
        email: "u@example.com",
        name: "U",
        isAdmin: false,
        passwordHash: "stored",
        disabledAt: new Date().toISOString(),
      },
    ]);
    const res = await request(app())
      .post("/auth/login")
      .send({ email: "u@example.com", password: "whatever" });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "This account has been disabled" });
  });

  it("does not reveal disabled state to a wrong-password attempt (still 401)", async () => {
    vi.mocked(verifyPassword).mockResolvedValueOnce(false);
    dbMock.setResult([
      {
        id: TEST_USER_ID,
        email: "u@example.com",
        name: "U",
        isAdmin: false,
        passwordHash: "stored",
        disabledAt: new Date().toISOString(),
      },
    ]);
    const res = await request(app())
      .post("/auth/login")
      .send({ email: "u@example.com", password: "wrong" });
    expect(res.status).toBe(401);
  });
});

describe("POST /auth/change-password", () => {
  it("changes the password when the current password is correct", async () => {
    vi.mocked(verifyPassword).mockResolvedValueOnce(true);
    dbMock.setResult([{ passwordHash: "stored" }]);
    const setSpy = dbMock.db.set as ReturnType<typeof vi.fn>;
    const res = await request(app())
      .post("/auth/change-password")
      .send({ currentPassword: "OldPass1!", newPassword: "NewPass1!" });
    expect(res.status).toBe(204);
    // The stored hash was updated to the freshly hashed new password.
    expect(setSpy).toHaveBeenCalledWith({ passwordHash: "new-hash" });
  });

  it("rejects a wrong current password with 400", async () => {
    vi.mocked(verifyPassword).mockResolvedValueOnce(false);
    dbMock.setResult([{ passwordHash: "stored" }]);
    const res = await request(app())
      .post("/auth/change-password")
      .send({ currentPassword: "WrongPass1!", newPassword: "NewPass1!" });
    expect(res.status).toBe(400);
  });

  it("rejects a weak new password with 400", async () => {
    dbMock.setResult([{ passwordHash: "stored" }]);
    const res = await request(app())
      .post("/auth/change-password")
      .send({ currentPassword: "OldPass1!", newPassword: "weak" });
    expect(res.status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app(false))
      .post("/auth/change-password")
      .send({ currentPassword: "OldPass1!", newPassword: "NewPass1!" });
    expect(res.status).toBe(401);
  });
});
