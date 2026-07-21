import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../config.js", () => ({
  config: { SECRET_KEY: "test-secret-key-at-least-16-chars" },
}));

afterEach(() => vi.resetModules());

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a value", async () => {
    const { encryptSecret, decryptSecret } = await import("./crypto.js");
    const plain = "sk-or-v1-abcdef0123456789";
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });

  it("does not store the plaintext anywhere in the ciphertext", async () => {
    const { encryptSecret } = await import("./crypto.js");
    const plain = "sk-or-v1-abcdef0123456789";
    const enc = encryptSecret(plain);
    expect(enc).not.toContain(plain);
    expect(enc.startsWith("enc:v1:")).toBe(true);
  });

  it("produces a different ciphertext each time (random IV)", async () => {
    const { encryptSecret, decryptSecret } = await import("./crypto.js");
    const a = encryptSecret("same-value");
    const b = encryptSecret("same-value");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it("passes legacy plaintext through unchanged so existing rows keep working", async () => {
    const { decryptSecret } = await import("./crypto.js");
    expect(decryptSecret("sk-plaintext-from-before-this-feature")).toBe(
      "sk-plaintext-from-before-this-feature",
    );
  });

  it("leaves empty values alone", async () => {
    const { encryptSecret, decryptSecret } = await import("./crypto.js");
    expect(encryptSecret("")).toBe("");
    expect(decryptSecret("")).toBe("");
  });

  it("rejects a tampered ciphertext rather than returning garbage", async () => {
    const { encryptSecret, decryptSecret } = await import("./crypto.js");
    const enc = encryptSecret("sensitive");
    const [prefix, version, iv, tag, data] = enc.split(":");
    // Flip the last character of the payload.
    const flipped = data.slice(0, -1) + (data.endsWith("A") ? "B" : "A");
    const tampered = [prefix, version, iv, tag, flipped].join(":");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("throws on a malformed encrypted value", async () => {
    const { decryptSecret } = await import("./crypto.js");
    expect(() => decryptSecret("enc:v1:only-one-part")).toThrow(/Malformed/);
  });

  it("cannot decrypt a value encrypted under a different key", async () => {
    const { encryptSecret } = await import("./crypto.js");
    const enc = encryptSecret("sensitive");

    vi.resetModules();
    vi.doMock("../config.js", () => ({ config: { SECRET_KEY: "a-completely-different-key" } }));
    const { decryptSecret } = await import("./crypto.js");
    expect(() => decryptSecret(enc)).toThrow();
  });

  it("reports whether a stored value is already encrypted", async () => {
    const { encryptSecret, isEncrypted } = await import("./crypto.js");
    expect(isEncrypted(encryptSecret("x"))).toBe(true);
    expect(isEncrypted("plaintext")).toBe(false);
    expect(isEncrypted("")).toBe(false);
  });
});
