import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const booleanFromString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SESSION_SECRET: z.string().min(1, "SESSION_SECRET is required"),
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  COOKIE_SECURE: booleanFromString.default("false"),
  // SameSite policy for the session cookie. Use "none" (with COOKIE_SECURE=true)
  // for a genuinely cross-site SPA, or "strict"/"lax" when the frontend and API
  // share a registrable domain. The same value is applied wherever the cookie is
  // set or cleared so the two stay consistent.
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
  CORS_ORIGIN: z.string().min(1).default("http://localhost:3000"),
  // Base URL of the n8n instance the backend forwards RAG requests to.
  // Private Docker hostname in deployment (http://n8n:5678).
  N8N_BASE_URL: z.string().url().default("http://localhost:5678"),
  // Optional per-endpoint override for the rag-read (Read Document) webhook.
  // Falls back to N8N_BASE_URL when unset — lets the read workflow live on a
  // different n8n instance (e.g. a staged migration) without moving the rest.
  N8N_READ_URL: z.string().url().optional(),

  // RAG backend selector. n8n (default) keeps the existing webhook path;
  // langgraph routes to the in-process LangChain/LangGraph implementation.
  RAG_PROVIDER: z.enum(["n8n", "langgraph"]).default("n8n"),

  // Langgraph-path config. Optional because the default provider is n8n; the
  // langgraph provider validates presence at use and throws a clear error.
  QDRANT_URL: z.string().url().optional(),
  QDRANT_COLLECTION_LG: z.string().min(1).default("project_rag_chat_lg"),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  GOTENBERG_URL: z.string().url().optional(),
  GEMINI_READ_MODEL: z.string().min(1).default("google/gemini-2.5-flash"),
  EMBED_MODEL: z.string().min(1).default("text-embedding-3-small"),
  GENERATE_MODEL: z.string().min(1).default("gpt-4o-mini"),

  // Phase 2 — Drive library. Optional because the library is disabled until
  // configured; the sync path validates presence at use and errors clearly.
  DRIVE_FOLDER_ID: z.string().min(1).optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().min(1).optional(),
  QDRANT_COLLECTION_LIBRARY: z.string().min(1).default("project_rag_library"),
  // Shared token authenticating the internal Drive-library backfill endpoints
  // (n8n → backend). Endpoints return 503 until this is set.
  LIBRARY_INDEX_TOKEN: z.string().min(1).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

// SameSite=None is only honored by browsers when the cookie is also Secure.
// Refuse to start with an incoherent configuration rather than silently
// shipping a cookie browsers will drop.
if (parsed.data.COOKIE_SAMESITE === "none" && !parsed.data.COOKIE_SECURE) {
  // eslint-disable-next-line no-console
  console.error(
    "Invalid environment configuration:\n" +
      "  - COOKIE_SAMESITE=none requires COOKIE_SECURE=true",
  );
  process.exit(1);
}

export const config = parsed.data;

export type AppConfig = typeof config;

export const isProduction = config.NODE_ENV === "production";
