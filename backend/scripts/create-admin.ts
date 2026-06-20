import { db, pool } from "../src/db/index.js";
import { users } from "../src/db/schema.js";
import { hashPassword } from "../src/auth/password.js";

/**
 * Create (or upsert) an admin user.
 *
 * Usage:
 *   npm run create-admin -- <email> <password> [name]
 * or via env:
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... ADMIN_NAME=... npm run create-admin
 */
async function main() {
  const [, , argEmail, argPassword, ...argNameParts] = process.argv;

  const email = (argEmail ?? process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = argPassword ?? process.env.ADMIN_PASSWORD ?? "";
  const name =
    (argNameParts.length > 0 ? argNameParts.join(" ") : process.env.ADMIN_NAME) ??
    null;

  if (!email || !password) {
    // eslint-disable-next-line no-console
    console.error(
      "Usage: npm run create-admin -- <email> <password> [name]\n" +
        "   or: set ADMIN_EMAIL and ADMIN_PASSWORD env vars.",
    );
    await pool.end();
    process.exit(1);
    return;
  }

  const passwordHash = await hashPassword(password);

  const [result] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      name,
      isAdmin: true,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        passwordHash,
        name,
        isAdmin: true,
      },
    })
    .returning({ email: users.email });

  // eslint-disable-next-line no-console
  console.log(`Admin user ready: ${result?.email ?? email}`);

  await pool.end();
}

main().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to create admin:", error);
  await pool.end();
  process.exit(1);
});
