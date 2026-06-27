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
  });
});
