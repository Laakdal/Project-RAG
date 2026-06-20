import { hash, verify } from "@node-rs/argon2";

// OWASP-recommended argon2id parameters.
const argon2Options = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, argon2Options);
}

export async function verifyPassword(
  passwordHash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, plain, argon2Options);
  } catch {
    // verify throws on malformed hashes; treat as a failed verification.
    return false;
  }
}
