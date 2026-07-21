import { sql, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { apiConnections, modelRoles, type ApiConnection } from "../db/schema.js";
import { getSetting } from "./service.js";
import { encryptSecret, decryptSecret } from "./crypto.js";

export type Role = "answer" | "intent" | "utility" | "reader" | "embedding";

// Pipeline roles a connection can be bound to (shown in the admin UI).
export const ROLES: { role: Role; label: string; note?: string }[] = [
  { role: "answer", label: "Chat / Answer generation" },
  { role: "intent", label: "Intent classifier" },
  {
    role: "utility",
    label: "Query utility (rewrite / grade / web search)",
    note: "Web search needs an OpenAI-compatible Responses API endpoint.",
  },
  { role: "reader", label: "Document reader (OCR / vision)" },
  { role: "embedding", label: "Embeddings" },
];

// Platform presets (label + default base URL). All OpenAI-compatible.
export const PLATFORMS: { key: string; label: string; baseUrl: string }[] = [
  { key: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { key: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { key: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  { key: "custom", label: "Custom (OpenAI-compatible)", baseUrl: "" },
];

// List the models a provider offers via its OpenAI-compatible /models endpoint,
// so the admin UI can present a dropdown for the selected connection.
export async function listProviderModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const url = `${baseUrl.replace(/\/+$/, "")}/models`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw new Error(`models request failed: ${res.status}`);
  const body = (await res.json()) as { data?: { id?: unknown }[] };
  const ids = (body.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return [...new Set(ids)].sort();
}

const ROLE_KEYS = new Set<string>(ROLES.map((r) => r.role));
export function isRole(r: string): r is Role {
  return ROLE_KEYS.has(r);
}

// In-memory caches for synchronous hot-path resolution (model factories).
let connCache: ApiConnection[] = [];
const roleCache = new Map<Role, string>();

export async function initConnections(): Promise<void> {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS api_connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL, platform text NOT NULL, base_url text NOT NULL,
    api_key text NOT NULL, model text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now())`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS model_roles (
    role text PRIMARY KEY, connection_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now())`);
  await reload();
  if (connCache.length === 0) await seedFromEnv();
}

async function reload(): Promise<void> {
  const rows = await db.select().from(apiConnections).orderBy(apiConnections.createdAt);
  // The cache holds usable plaintext keys; only the DB column is encrypted.
  connCache = rows.map((r) => ({ ...r, apiKey: decryptSecret(r.apiKey) }));
  roleCache.clear();
  for (const r of await db.select().from(modelRoles)) roleCache.set(r.role as Role, r.connectionId);
}

// Seed connections + role bindings from the current env config so pipeline
// behaviour is unchanged on the first deploy of this feature.
async function seedFromEnv(): Promise<void> {
  const orKey = getSetting("OPENROUTER_API_KEY") ?? "";
  const oaKey = getSetting("OPENAI_API_KEY") ?? "";
  const orBase = "https://openrouter.ai/api/v1";
  const oaBase = "https://api.openai.com/v1";
  const seed: { name: string; platform: string; baseUrl: string; apiKey: string; model: string; roles: Role[] }[] = [
    { name: "OpenRouter — answer", platform: "openrouter", baseUrl: orBase, apiKey: orKey, model: getSetting("ANSWER_MODEL") ?? "z-ai/glm-4.6", roles: ["answer"] },
    { name: "OpenRouter — reader & intent", platform: "openrouter", baseUrl: orBase, apiKey: orKey, model: getSetting("GEMINI_READ_MODEL") ?? "google/gemini-2.5-flash", roles: ["intent", "reader"] },
    { name: "OpenAI — utility", platform: "openai", baseUrl: oaBase, apiKey: oaKey, model: getSetting("GENERATE_MODEL") ?? "gpt-4o-mini", roles: ["utility"] },
    { name: "OpenAI — embeddings", platform: "openai", baseUrl: oaBase, apiKey: oaKey, model: getSetting("EMBED_MODEL") ?? "text-embedding-3-small", roles: ["embedding"] },
  ];
  for (const s of seed) {
    const [ins] = await db
      .insert(apiConnections)
      .values({
        name: s.name,
        platform: s.platform,
        baseUrl: s.baseUrl,
        apiKey: encryptSecret(s.apiKey),
        model: s.model,
      })
      .returning();
    for (const role of s.roles) {
      await db
        .insert(modelRoles)
        .values({ role, connectionId: ins.id })
        .onConflictDoUpdate({ target: modelRoles.role, set: { connectionId: ins.id, updatedAt: new Date() } });
    }
  }
  await reload();
}

// Synchronous resolution used by the model factories.
export function resolveRole(role: Role): ApiConnection | undefined {
  const id = roleCache.get(role);
  return id ? connCache.find((c) => c.id === id) : undefined;
}

export function listConnections(): ApiConnection[] {
  return connCache;
}

export function roleBindings(): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const { role } of ROLES) out[role] = roleCache.get(role) ?? null;
  return out;
}

export async function createConnection(data: {
  name: string;
  platform: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}): Promise<void> {
  await db.insert(apiConnections).values({ ...data, apiKey: encryptSecret(data.apiKey) });
  await reload();
}

export async function updateConnection(
  id: string,
  data: { name: string; platform: string; baseUrl: string; apiKey: string; model: string },
): Promise<void> {
  await db
    .update(apiConnections)
    .set({ ...data, apiKey: encryptSecret(data.apiKey) })
    .where(eq(apiConnections.id, id));
  await reload();
}

export async function deleteConnection(id: string): Promise<void> {
  await db.delete(modelRoles).where(eq(modelRoles.connectionId, id));
  await db.delete(apiConnections).where(eq(apiConnections.id, id));
  await reload();
}

export async function setRole(role: Role, connectionId: string): Promise<void> {
  await db
    .insert(modelRoles)
    .values({ role, connectionId })
    .onConflictDoUpdate({ target: modelRoles.role, set: { connectionId, updatedAt: new Date() } });
  await reload();
}
