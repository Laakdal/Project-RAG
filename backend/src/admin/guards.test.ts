import { describe, it, expect } from "vitest";
import { GuardError, ensureNotSelf, ensureNotLastAdmin } from "./guards.js";

describe("ensureNotSelf", () => {
  it("throws a 409 GuardError when acting on your own account", () => {
    try {
      ensureNotSelf("u1", "u1");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GuardError);
      expect((err as GuardError).status).toBe(409);
    }
  });

  it("allows acting on a different account", () => {
    expect(() => ensureNotSelf("u1", "u2")).not.toThrow();
  });
});

describe("ensureNotLastAdmin", () => {
  it("throws when the target is the last active admin", () => {
    try {
      ensureNotLastAdmin(1, true);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GuardError);
      expect((err as GuardError).status).toBe(409);
    }
  });

  it("allows when other active admins remain", () => {
    expect(() => ensureNotLastAdmin(2, true)).not.toThrow();
  });

  it("allows when the target is not an active admin", () => {
    expect(() => ensureNotLastAdmin(1, false)).not.toThrow();
  });
});
