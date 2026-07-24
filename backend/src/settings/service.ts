import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { settings as settingsTable } from "../db/schema.js";
import { config } from "../config.js";
import { encryptSecret, decryptSecret } from "./crypto.js";

// Keys manageable from the admin Settings panel. A DB value overrides the env
// default of the same name. `secret` values are never returned to the client
// (only whether they are set); everything else is returned so the field can be
// edited in place. `multiline` hints the UI to use a textarea.
// `hidden` keys stay resolvable via getSetting (env fallback for unbound roles)
// but are not shown in the flat Integrations panel — the LLM keys/models are now
// managed as API connections instead (see settings/connections.ts).
export const MANAGED_SETTINGS = [
  { key: "LIBRARY_INDEX_TOKEN", label: "Library index token", secret: true, multiline: false, hidden: false },
  // Managed under Drive Sources now (one service account + folder per account).
  { key: "GOOGLE_SERVICE_ACCOUNT_JSON", label: "Google service account JSON", secret: true, multiline: true, hidden: true },
  { key: "DRIVE_FOLDER_ID", label: "Drive folder ID", secret: false, multiline: false, hidden: true },
  { key: "OPENROUTER_API_KEY", label: "OpenRouter API key", secret: true, multiline: false, hidden: true },
  { key: "OPENAI_API_KEY", label: "OpenAI API key", secret: true, multiline: false, hidden: true },
  { key: "ANSWER_MODEL", label: "Answer model", secret: false, multiline: false, hidden: true },
  { key: "ANSWER_MODEL_REASONING", label: "Answer model (reasoning)", secret: false, multiline: false, hidden: true },
  { key: "INTENT_MODEL", label: "Intent classifier model", secret: false, multiline: false, hidden: true },
  { key: "GENERATE_MODEL", label: "Utility model", secret: false, multiline: false, hidden: true },
  { key: "EMBED_MODEL", label: "Embedding model", secret: false, multiline: false, hidden: true },
  { key: "GEMINI_READ_MODEL", label: "Document reader model", secret: false, multiline: false, hidden: true },
] as const;

export type ManagedKey = (typeof MANAGED_SETTINGS)[number]["key"];

const MANAGED_KEYS = new Set<string>(MANAGED_SETTINGS.map((m) => m.key));

// Only the secret-flagged keys are encrypted at rest; model names and folder ids
// are not credentials and stay readable in the DB.
const SECRET_KEYS = new Set<string>(
  MANAGED_SETTINGS.filter((m) => m.secret).map((m) => m.key),
);

// In-memory cache of the DB overrides, loaded at startup and updated on write so
// hot-path callers (the model factories) can read synchronously.
const overrides = new Map<string, string>();

// Create the table if needed and load current overrides. Best-effort: on any
// failure callers still fall back to the env config, so the server keeps working.
export async function initSettings(): Promise<void> {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS settings (
    key text PRIMARY KEY,
    value text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  const rows = await db.select().from(settingsTable);
  overrides.clear();
  // The cache holds usable plaintext; only the DB column is encrypted.
  for (const r of rows) {
    if (!r.value) continue;
    overrides.set(r.key, SECRET_KEYS.has(r.key) ? decryptSecret(r.value) : r.value);
  }
}

// Effective value for a managed key: DB override, else the env/config default.
export function getSetting(key: ManagedKey): string | undefined {
  const dbVal = overrides.get(key);
  if (dbVal) return dbVal;
  const envVal = (config as unknown as Record<string, unknown>)[key];
  return typeof envVal === "string" && envVal !== "" ? envVal : undefined;
}

export async function setSetting(key: ManagedKey, value: string): Promise<void> {
  const stored = SECRET_KEYS.has(key) ? encryptSecret(value) : value;
  await db
    .insert(settingsTable)
    .values({ key, value: stored })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value: stored, updatedAt: new Date() },
    });
  overrides.set(key, value);
}

export function isManagedKey(key: string): key is ManagedKey {
  return MANAGED_KEYS.has(key);
}

// Safe view for the admin UI: secrets expose only whether they are set (and
// where the value comes from), never the value itself.
export function managedView() {
  return MANAGED_SETTINGS.filter((m) => !m.hidden).map((m) => {
    const effective = getSetting(m.key);
    const fromDb = overrides.has(m.key);
    return {
      key: m.key,
      label: m.label,
      secret: m.secret,
      multiline: m.multiline,
      isSet: Boolean(effective),
      source: fromDb ? "db" : effective ? "env" : "unset",
      value: m.secret ? undefined : (effective ?? ""),
    };
  });
}
