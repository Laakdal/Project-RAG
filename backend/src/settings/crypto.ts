import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";

// Symmetric encryption for the credentials we have to store retrievably: API
// connection keys, Drive client secrets and refresh tokens, and secret settings.
// Passwords are hashed with argon2 instead — those never need to be read back.
//
// AES-256-GCM is authenticated, so a tampered ciphertext fails to decrypt rather
// than silently yielding garbage that we would then send to a provider.

const PREFIX = "enc:v1";
const IV_BYTES = 12; // 96-bit nonce, the size GCM is specified for

// SECRET_KEY is an arbitrary-length string; hash it to exactly the 32 bytes
// AES-256 requires. Computed per call — this is not on a hot path (values are
// decrypted once at startup into the in-memory caches).
function key(): Buffer {
  return createHash("sha256").update(config.SECRET_KEY).digest();
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return plaintext;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(
    ":",
  );
}

// Rows written before this feature existed hold bare plaintext. Those are passed
// through unchanged so an existing deployment keeps working; each one is
// re-encrypted the next time it is saved. Anything carrying the prefix must
// decrypt successfully — a failure there means a wrong SECRET_KEY or a corrupted
// value, and returning the raw ciphertext would quietly send it to a provider as
// if it were a credential.
export function decryptSecret(stored: string): string {
  if (!stored || !stored.startsWith(`${PREFIX}:`)) return stored;
  // The prefix itself contains a colon, so the parts are: enc, v1, iv, tag, data.
  const [, , ivB64, tagB64, dataB64] = stored.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted value: expected enc:v1:<iv>:<tag>:<ciphertext>");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

// True when a stored value is already encrypted. Lets callers tell "needs
// migrating" from "already done" without attempting a decrypt.
export function isEncrypted(stored: string): boolean {
  return Boolean(stored) && stored.startsWith(`${PREFIX}:`);
}
