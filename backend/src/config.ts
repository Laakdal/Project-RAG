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

  // Local-first PDF extraction (src/rag/pdf-extract.ts): pull the text layer with
  // pdftotext and OCR only image pages via Gemini. Set false to fall back to the
  // whole-file rag-read path for every PDF.
  LOCAL_PDF_EXTRACT: booleanFromString.default("true"),
  // Parallel per-page OCR calls — bounds load on the n8n/Gemini egress.
  OCR_PAGE_CONCURRENCY: z.coerce.number().int().positive().default(4),
  // A page whose extracted text is shorter than this is treated as an image page
  // that needs OCR.
  PDF_TEXT_MIN_CHARS: z.coerce.number().int().nonnegative().default(16),
  // pdftoppm render resolution (DPI) for pages sent to OCR.
  PDF_RENDER_DPI: z.coerce.number().int().positive().default(150),

  // Phase 2 — Drive library. Optional because the library is disabled until
  // configured; the sync path validates presence at use and errors clearly.
  DRIVE_FOLDER_ID: z.string().min(1).optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().min(1).optional(),
  QDRANT_COLLECTION_LIBRARY: z.string().min(1).default("project_rag_library"),

  // Per-chat retrieval (RAG) for uploaded docs — see src/rag/attachment-vectors.ts.
  // Chunks are embedded into this collection, scoped by conversationId.
  QDRANT_COLLECTION_CHAT: z.string().min(1).default("rag_chat_chunks"),
  // Top-k chunks retrieved per query when a conversation's docs are large.
  CHAT_RETRIEVE_TOP_K: z.coerce.number().int().positive().default(8),
  // Below this total extracted-text size (chars) across a conversation's ready
  // docs, inject the whole text (no retrieval miss on a short doc); above it,
  // retrieve only the top-k relevant chunks so a big book fits the context window.
  CHAT_WHOLE_DOC_MAX_CHARS: z.coerce.number().int().positive().default(24000),
  // Relevance gate: if the top per-chat chunk's similarity score is below this,
  // the attached file is treated as NOT about the question, so the chat falls
  // through to the shared library / Drive search instead of answering from the
  // (irrelevant) attachment. Cosine-ish score in ~[0,1]; tune against real docs.
  CHAT_RELEVANCE_THRESHOLD: z.coerce.number().default(0.35),

  // Shared secret for the internal Drive-backfill endpoints (n8n -> backend).
  // The bulk indexer authenticates with this token via the x-index-token header
  // instead of an admin session. Endpoints refuse to run when it is unset.
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
