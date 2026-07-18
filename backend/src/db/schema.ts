import {
  boolean,
  customType,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Postgres `bytea` column for the original uploaded file bytes (comes back as a
// Node Buffer). Used so attachments can be served back for in-browser preview.
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  isAdmin: boolean("is_admin").notNull().default(false),
  // null = active; a timestamp records when the account was disabled (blocked
  // from logging in) by an admin.
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("New chat"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // "user" | "assistant"
  content: text("content").notNull(),
  sources: jsonb("sources"), // [{filename, chunkIndex, text}] | null
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  status: text("status").notNull().default("indexing"), // indexing | ready | failed
  chunkCount: integer("chunk_count"),
  // Original file bytes + content type, stored on a successful ingest so the
  // file can be opened/previewed in the browser. Nullable: legacy rows (and
  // failed ingests, which persist nothing) have none.
  mimeType: text("mime_type"),
  data: bytea("data"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;

export const libraryDocuments = pgTable("library_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Where the doc came from and its source-native id (Drive file id in P2).
  source: text("source").notNull(), // 'upload' | 'drive'
  sourceRef: text("source_ref"), // drive file id for P2; null for uploads
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  chunkCount: integer("chunk_count").notNull().default(0),
  status: text("status").notNull(), // 'indexing' | 'indexed' | 'failed'
  lastError: text("last_error"),
  // P2 (Drive change detection); null for uploads.
  modifiedTime: text("modified_time"),
  webUrl: text("web_url"),
  indexedAt: timestamp("indexed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type LibraryDocument = typeof libraryDocuments.$inferSelect;
export type NewLibraryDocument = typeof libraryDocuments.$inferInsert;

// Admin-editable runtime settings (API keys, model names, Drive config). A DB
// value overrides the env default for the same key; see src/settings/service.ts.
// The table is created idempotently at startup, so it needs no migration file.
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Setting = typeof settings.$inferSelect;

// Admin-managed API connections (OpenAI-compatible provider endpoints). Each is
// a reusable {base URL, key, model} that pipeline roles bind to. Created
// idempotently at startup; see src/settings/connections.ts.
export const apiConnections = pgTable("api_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  platform: text("platform").notNull(), // preset label: 'openrouter' | 'openai' | '9router' | 'custom' ...
  baseUrl: text("base_url").notNull(),
  apiKey: text("api_key").notNull(),
  model: text("model").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ApiConnection = typeof apiConnections.$inferSelect;

// Which connection each pipeline role uses (answer, intent, utility, reader, embedding).
export const modelRoles = pgTable("model_roles", {
  role: text("role").primaryKey(),
  connectionId: uuid("connection_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ModelRole = typeof modelRoles.$inferSelect;
