import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { settings as settingsTable } from "../db/schema.js";
import { config } from "../config.js";

// Keys manageable from the admin Settings panel. A DB value overrides the env
// default of the same name. `secret` values are never returned to the client
// (only whether they are set); everything else is returned so the field can be
// edited in place. `multiline` hints the UI to use a textarea.
export const MANAGED_SETTINGS = [
  { key: "OPENROUTER_API_KEY", label: "OpenRouter API key", secret: true, multiline: false },
  { key: "OPENAI_API_KEY", label: "OpenAI API key", secret: true, multiline: false },
  { key: "GOOGLE_SERVICE_ACCOUNT_JSON", label: "Google service account JSON", secret: true, multiline: true },
  { key: "LIBRARY_INDEX_TOKEN", label: "Library index token", secret: true, multiline: false },
  { key: "DRIVE_FOLDER_ID", label: "Drive folder ID", secret: false, multiline: false },
  { key: "ANSWER_MODEL", label: "Answer model (glm-4.6 via OpenRouter)", secret: false, multiline: false },
  { key: "INTENT_MODEL", label: "Intent classifier model", secret: false, multiline: false },
  { key: "GENERATE_MODEL", label: "Utility model (rewrite / grade / web search)", secret: false, multiline: false },
  { key: "EMBED_MODEL", label: "Embedding model", secret: false, multiline: false },
  { key: "GEMINI_READ_MODEL", label: "Document reader model", secret: false, multiline: false },
] as const;

export type ManagedKey = (typeof MANAGED_SETTINGS)[number]["key"];

const MANAGED_KEYS = new Set<string>(MANAGED_SETTINGS.map((m) => m.key));

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
  for (const r of rows) if (r.value) overrides.set(r.key, r.value);
}

// Effective value for a managed key: DB override, else the env/config default.
export function getSetting(key: ManagedKey): string | undefined {
  const dbVal = overrides.get(key);
  if (dbVal) return dbVal;
  const envVal = (config as unknown as Record<string, unknown>)[key];
  return typeof envVal === "string" && envVal !== "" ? envVal : undefined;
}

export async function setSetting(key: ManagedKey, value: string): Promise<void> {
  await db
    .insert(settingsTable)
    .values({ key, value })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
  overrides.set(key, value);
}

export function isManagedKey(key: string): key is ManagedKey {
  return MANAGED_KEYS.has(key);
}

// Safe view for the admin UI: secrets expose only whether they are set (and
// where the value comes from), never the value itself.
export function managedView() {
  return MANAGED_SETTINGS.map((m) => {
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
