import { eq } from "drizzle-orm";
import { db, pool } from "../src/db/index.js";
import { apiConnections, driveSources, settings } from "../src/db/schema.js";
import { encryptSecret, isEncrypted } from "../src/settings/crypto.js";
import { MANAGED_SETTINGS } from "../src/settings/service.js";

/**
 * Encrypt credentials that were stored before encryption-at-rest existed.
 *
 * New and updated rows are encrypted by the settings modules themselves; rows
 * written earlier stay plaintext until they are next saved (decryptSecret passes
 * them through). This walks those rows once and encrypts them in place.
 *
 * Idempotent: already-encrypted values are skipped, so a second run is a no-op.
 * Without that check a re-run would encrypt the ciphertext again and the value
 * would need two decrypt passes to recover.
 *
 * Requires the same SECRET_KEY the application runs with — encrypting under a
 * different key would leave rows the app cannot read.
 *
 * Usage (inside the backend container):
 *   node dist/scripts/encrypt-credentials.js [--dry-run]
 */

const dryRun = process.argv.includes("--dry-run");

// Never log a credential; report only counts and non-secret identifiers.
function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(message);
}

const SECRET_SETTING_KEYS = new Set<string>(
  MANAGED_SETTINGS.filter((m) => m.secret).map((m) => m.key),
);

async function encryptApiConnections(): Promise<[number, number]> {
  const rows = await db.select().from(apiConnections);
  let done = 0;
  for (const row of rows) {
    if (!row.apiKey || isEncrypted(row.apiKey)) continue;
    if (!dryRun) {
      await db
        .update(apiConnections)
        .set({ apiKey: encryptSecret(row.apiKey) })
        .where(eq(apiConnections.id, row.id));
    }
    log(`  api_connections: ${row.name}`);
    done++;
  }
  return [done, rows.length];
}

async function encryptDriveSources(): Promise<[number, number]> {
  const rows = await db.select().from(driveSources);
  let done = 0;
  for (const row of rows) {
    const set: Record<string, string> = {};
    if (row.clientSecret && !isEncrypted(row.clientSecret)) {
      set.clientSecret = encryptSecret(row.clientSecret);
    }
    if (row.refreshToken && !isEncrypted(row.refreshToken)) {
      set.refreshToken = encryptSecret(row.refreshToken);
    }
    if (Object.keys(set).length === 0) continue;
    if (!dryRun) {
      await db.update(driveSources).set(set).where(eq(driveSources.id, row.id));
    }
    log(`  drive_sources: ${row.name} (${Object.keys(set).join(", ")})`);
    done++;
  }
  return [done, rows.length];
}

async function encryptSettings(): Promise<[number, number]> {
  const rows = await db.select().from(settings);
  let done = 0;
  for (const row of rows) {
    // Model names and folder ids are not credentials — leave them readable.
    if (!SECRET_SETTING_KEYS.has(row.key)) continue;
    if (!row.value || isEncrypted(row.value)) continue;
    if (!dryRun) {
      await db
        .update(settings)
        .set({ value: encryptSecret(row.value) })
        .where(eq(settings.key, row.key));
    }
    log(`  settings: ${row.key}`);
    done++;
  }
  return [done, rows.length];
}

async function main(): Promise<void> {
  log(dryRun ? "Dry run — no rows will be written.\n" : "Encrypting plaintext credentials.\n");

  const [conns, connTotal] = await encryptApiConnections();
  const [drives, driveTotal] = await encryptDriveSources();
  const [sets, setTotal] = await encryptSettings();

  log(
    `\napi_connections: ${conns} of ${connTotal} encrypted` +
      `\ndrive_sources:   ${drives} of ${driveTotal} encrypted` +
      `\nsettings:        ${sets} of ${setTotal} rows encrypted (secret keys only)`,
  );
  if (conns + drives + sets === 0) log("\nNothing to do — everything is already encrypted.");
  else if (dryRun) log("\nRe-run without --dry-run to apply.");

  await pool.end();
}

main().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error("Backfill failed:", error);
  await pool.end();
  process.exit(1);
});
