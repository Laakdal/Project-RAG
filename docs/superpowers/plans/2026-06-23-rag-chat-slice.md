# RAG Chat Slice 1 — Per-Chat Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in user upload a PDF/DOCX into a chat and ask questions answered from that document, with a Sources list.

**Architecture:** n8n owns the RAG loop (embed → retrieve → generate) as two workflows reached only over the private Docker network. The Express backend is a thin authenticated proxy that also persists chat history in Postgres. The Next.js frontend chat view talks only to the backend, non-streaming.

**Tech Stack:** Express 5 + TypeScript (ESM), Drizzle ORM + Postgres, Vitest + supertest (new), multer (new), n8n (OpenAI Embeddings + Qdrant + Anthropic nodes), Next.js 15 + axios.

## Global Constraints

- Backend is ESM (`"type": "module"`); all local imports use the `.js` extension (e.g. `./db/index.js`).
- Embeddings: OpenAI `text-embedding-3-small`, vector dim **1536**, Qdrant distance **Cosine**.
- Generation: Claude **`claude-sonnet-4-6`** (set in the n8n Anthropic node).
- File types for this slice: **PDF and DOCX only**. Reject others before calling n8n.
- AI provider keys (OpenAI, Anthropic) live ONLY in n8n credentials — never in the backend or repo.
- Mutating routes (POST) require both `requireAuth` and `requireCsrf`; GET routes require `requireAuth`.
- Every conversation-scoped route verifies the conversation belongs to `req.session.userId`.
- Qdrant collection name: **`chat_attachments`**. Retrieval ALWAYS filters on `conversationId`.
- Spec of record: `docs/superpowers/specs/2026-06-23-rag-chat-slice-design.md`.

---

### Task 1: Backend test infra + `N8N_BASE_URL` config

**Files:**
- Modify: `backend/package.json` (scripts + devDeps)
- Create: `backend/vitest.config.ts`
- Modify: `backend/src/config.ts:23` (add `N8N_BASE_URL`)
- Create: `backend/src/config.test.ts`

**Interfaces:**
- Produces: `config.N8N_BASE_URL: string` — base URL for n8n, e.g. `http://n8n:5678`.

- [ ] **Step 1: Install dev dependencies**

```bash
cd backend
npm install -D vitest supertest @types/supertest
npm install multer
npm install -D @types/multer
```

- [ ] **Step 2: Add test script to `backend/package.json`**

In the `"scripts"` block, add:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Create `backend/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Write the failing config test** — `backend/src/config.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { config } from "./config.js";

describe("config", () => {
  it("exposes N8N_BASE_URL with a default", () => {
    expect(typeof config.N8N_BASE_URL).toBe("string");
    expect(config.N8N_BASE_URL.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

Run: `cd backend && npx vitest run src/config.test.ts`
Expected: FAIL — `N8N_BASE_URL` is undefined.

- [ ] **Step 6: Add `N8N_BASE_URL` to the env schema** — in `backend/src/config.ts`, inside `envSchema` after the `CORS_ORIGIN` line:

```typescript
  CORS_ORIGIN: z.string().min(1).default("http://localhost:3000"),
  // Base URL of the n8n instance the backend forwards RAG requests to.
  // Private Docker hostname in deployment (http://n8n:5678).
  N8N_BASE_URL: z.string().url().default("http://localhost:5678"),
```

- [ ] **Step 7: Run the test and watch it pass**

Run: `cd backend && npx vitest run src/config.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/vitest.config.ts backend/src/config.ts backend/src/config.test.ts
git commit -m "add vitest and N8N_BASE_URL config to the backend"
```

---

### Task 2: Database schema — conversations, messages, attachments

**Files:**
- Modify: `backend/src/db/schema.ts` (append tables)
- Create: migration `backend/migrations/0002_*.sql` (generated)

**Interfaces:**
- Produces: Drizzle tables `conversations`, `messages`, `attachments` and their inferred types `Conversation`, `Message`, `Attachment`.

- [ ] **Step 1: Append the tables to `backend/src/db/schema.ts`**

```typescript
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ... existing users table stays above ...

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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
```

Note: keep the existing `boolean`/`text`/`timestamp`/`uuid` imports; add `integer` and `jsonb` to the import list as shown.

- [ ] **Step 2: Generate the migration**

Run: `cd backend && npm run db:generate`
Expected: a new file `backend/migrations/0002_*.sql` containing `CREATE TABLE "conversations" ...`, `"messages"`, `"attachments"`.

- [ ] **Step 3: Verify the SQL**

Run: `ls backend/migrations` and open the new `0002_*.sql`. Confirm all three `CREATE TABLE` statements and the foreign keys are present.

- [ ] **Step 4: Apply the migration locally**

Run: `cd backend && npm run db:migrate`
Expected: "Migrations complete." with no error.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/schema.ts backend/migrations
git commit -m "add conversations, messages, and attachments tables"
```

---

### Task 3: n8n client module

**Files:**
- Create: `backend/src/rag/n8n-client.ts`
- Create: `backend/src/rag/n8n-client.test.ts`

**Interfaces:**
- Produces:
  - `type QuerySource = { filename: string; chunkIndex: number; text: string }`
  - `type QueryResult = { answer: string; sources: QuerySource[] }`
  - `type IngestResult = { status: string; chunkCount: number }`
  - `queryRag(conversationId: string, question: string): Promise<QueryResult>`
  - `ingestFile(conversationId: string, filename: string, file: Buffer, mimeType: string): Promise<IngestResult>`
- Consumes: `config.N8N_BASE_URL` (Task 1).

- [ ] **Step 1: Write the failing test** — `backend/src/rag/n8n-client.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { queryRag, ingestFile } from "./n8n-client.js";

describe("n8n-client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("queryRag posts to the query webhook and returns the parsed result", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: "Paris.",
        sources: [{ filename: "geo.pdf", chunkIndex: 0, text: "capital is Paris" }],
      }),
    });

    const result = await queryRag("conv-1", "What is the capital of France?");

    expect(result.answer).toBe("Paris.");
    expect(result.sources[0].filename).toBe("geo.pdf");
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("/webhook/rag-query");
    expect(JSON.parse(init.body)).toEqual({
      conversationId: "conv-1",
      question: "What is the capital of France?",
    });
  });

  it("queryRag throws on a non-ok response", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500 });
    await expect(queryRag("conv-1", "hi")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run src/rag/n8n-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `backend/src/rag/n8n-client.ts`**

```typescript
import { config } from "../config.js";

export type QuerySource = {
  filename: string;
  chunkIndex: number;
  text: string;
};

export type QueryResult = {
  answer: string;
  sources: QuerySource[];
};

export type IngestResult = {
  status: string;
  chunkCount: number;
};

const QUERY_PATH = "/webhook/rag-query";
const INGEST_PATH = "/webhook/rag-ingest";

function url(path: string): string {
  return `${config.N8N_BASE_URL.replace(/\/$/, "")}${path}`;
}

export async function queryRag(
  conversationId: string,
  question: string,
): Promise<QueryResult> {
  const res = await fetch(url(QUERY_PATH), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, question }),
  });
  if (!res.ok) {
    throw new Error(`n8n query failed: ${res.status}`);
  }
  const data = (await res.json()) as Partial<QueryResult>;
  return {
    answer: data.answer ?? "",
    sources: Array.isArray(data.sources) ? data.sources : [],
  };
}

export async function ingestFile(
  conversationId: string,
  filename: string,
  file: Buffer,
  mimeType: string,
): Promise<IngestResult> {
  const form = new FormData();
  form.append("conversationId", conversationId);
  // Wrap the buffer as a Blob so multipart sends the binary with a filename.
  form.append("file", new Blob([file], { type: mimeType }), filename);

  const res = await fetch(url(INGEST_PATH), { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`n8n ingest failed: ${res.status}`);
  }
  const data = (await res.json()) as Partial<IngestResult>;
  return {
    status: data.status ?? "ok",
    chunkCount: typeof data.chunkCount === "number" ? data.chunkCount : 0,
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd backend && npx vitest run src/rag/n8n-client.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add backend/src/rag/n8n-client.ts backend/src/rag/n8n-client.test.ts
git commit -m "add n8n client for rag query and ingest"
```

---

### Task 4: Shared test helper (app + fake session + db mock)

**Files:**
- Create: `backend/src/test/app-harness.ts`

**Interfaces:**
- Produces: `buildTestApp(opts): { app, db }` — an Express app mounting the chat router with auth/session faked to a fixed user, and a mockable `db`. Used by Tasks 5–7 route tests.

- [ ] **Step 1: Create `backend/src/test/app-harness.ts`**

```typescript
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { vi } from "vitest";

export const TEST_USER_ID = "11111111-1111-1111-1111-111111111111";

// A chainable Drizzle-like mock. Each query builder method returns `this`,
// and awaiting resolves to `result`. Tests set `db.__result` per call.
export function makeDbMock() {
  const state: { result: unknown } = { result: [] };
  const chain: Record<string, unknown> = {};
  const methods = [
    "select",
    "from",
    "where",
    "limit",
    "orderBy",
    "insert",
    "values",
    "returning",
    "update",
    "set",
    "delete",
  ];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(state.result).then(resolve);
  return {
    db: chain,
    setResult(result: unknown) {
      state.result = result;
    },
  };
}

// Builds an app that injects a fake authenticated session, then mounts a router.
export function buildTestApp(
  mountRouter: (app: express.Express) => void,
  authed = true,
): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    // Fake session + CSRF so route guards pass in unit tests.
    (req as Request & { session: { userId?: string } }).session = authed
      ? { userId: TEST_USER_ID }
      : {};
    next();
  });
  mountRouter(app);
  return app;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors from `app-harness.ts`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/test/app-harness.ts
git commit -m "add test harness for chat route tests"
```

---

### Task 5: Conversation routes (create, list, history)

**Files:**
- Create: `backend/src/rag/chat-routes.ts`
- Create: `backend/src/rag/chat-routes.test.ts`

**Interfaces:**
- Produces: `chatRouter` (Express `Router`) with:
  - `POST /conversations` → 201 `{ id, title, createdAt }`
  - `GET /conversations` → 200 `[{ id, title, createdAt }]`
  - `GET /conversations/:id/messages` → 200 `[{ id, role, content, sources, createdAt }]`
- Consumes: `requireAuth` (`../auth/middleware.js`), `requireCsrf` (`../auth/csrf.js`), `db` + `conversations`/`messages` (`../db`).

- [ ] **Step 1: Write the failing test** — `backend/src/rag/chat-routes.test.ts`

```typescript
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { buildTestApp, makeDbMock, TEST_USER_ID } from "../test/app-harness.js";

const dbMock = makeDbMock();
vi.mock("../db/index.js", () => ({ db: dbMock.db }));
vi.mock("../auth/csrf.js", () => ({
  requireCsrf: (_req: unknown, _res: unknown, next: () => void) => next(),
  CSRF_HEADER_NAME: "x-csrf-token",
}));

// Imported after mocks are registered.
const { chatRouter } = await import("./chat-routes.js");

function app() {
  return buildTestApp((a) => a.use("/chat", chatRouter));
}

describe("conversation routes", () => {
  it("creates a conversation owned by the session user", async () => {
    dbMock.setResult([
      { id: "c1", title: "New chat", createdAt: new Date().toISOString() },
    ]);
    const res = await request(app()).post("/chat/conversations").send({});
    expect(res.status).toBe(201);
    expect(res.body.id).toBe("c1");
  });

  it("lists conversations", async () => {
    dbMock.setResult([{ id: "c1", title: "New chat", createdAt: "t" }]);
    const res = await request(app()).get("/chat/conversations");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("returns 404 for a conversation the user does not own", async () => {
    dbMock.setResult([]); // ownership lookup finds nothing
    const res = await request(app()).get("/chat/conversations/cX/messages");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run src/rag/chat-routes.test.ts`
Expected: FAIL — `./chat-routes.js` not found.

- [ ] **Step 3: Implement `backend/src/rag/chat-routes.ts`** (conversation routes only for now)

```typescript
import { Router, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { conversations, messages } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";
import { requireCsrf } from "../auth/csrf.js";

const router = Router();
router.use(requireAuth);

// Resolve a conversation owned by the session user, or null.
async function ownedConversation(userId: string, conversationId: string) {
  const rows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(eq(conversations.id, conversationId), eq(conversations.userId, userId)),
    )
    .limit(1);
  return rows[0] ?? null;
}

router.post("/conversations", requireCsrf, async (req: Request, res: Response) => {
  const userId = req.session.userId as string;
  const rows = await db
    .insert(conversations)
    .values({ userId })
    .returning({
      id: conversations.id,
      title: conversations.title,
      createdAt: conversations.createdAt,
    });
  res.status(201).json(rows[0]);
});

router.get("/conversations", async (req: Request, res: Response) => {
  const userId = req.session.userId as string;
  const rows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.createdAt));
  res.json(rows);
});

router.get(
  "/conversations/:id/messages",
  async (req: Request, res: Response) => {
    const userId = req.session.userId as string;
    const owned = await ownedConversation(userId, req.params.id);
    if (!owned) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const rows = await db
      .select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        sources: messages.sources,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.conversationId, req.params.id))
      .orderBy(messages.createdAt);
    res.json(rows);
  },
);

export { router as chatRouter, ownedConversation };
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd backend && npx vitest run src/rag/chat-routes.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add backend/src/rag/chat-routes.ts backend/src/rag/chat-routes.test.ts
git commit -m "add conversation create, list, and history routes"
```

---

### Task 6: Message route (ask a question → n8n → persist)

**Files:**
- Modify: `backend/src/rag/chat-routes.ts` (add POST messages route)
- Modify: `backend/src/rag/chat-routes.test.ts` (add cases)

**Interfaces:**
- Produces: `POST /conversations/:id/messages` `{ question }` → 200 `{ answer, sources }`.
- Consumes: `queryRag` (`./n8n-client.js`), `ownedConversation` (Task 5).

- [ ] **Step 1: Add the failing test cases** to `backend/src/rag/chat-routes.test.ts`

At the top, add the n8n mock alongside the others (before the dynamic import):

```typescript
vi.mock("./n8n-client.js", () => ({
  queryRag: vi.fn(async () => ({
    answer: "42",
    sources: [{ filename: "doc.pdf", chunkIndex: 1, text: "the answer is 42" }],
  })),
}));
```

Add a describe block:

```typescript
describe("message route", () => {
  it("rejects an empty question with 400", async () => {
    dbMock.setResult([{ id: "c1" }]); // owned
    const res = await request(app())
      .post("/chat/conversations/c1/messages")
      .send({ question: "" });
    expect(res.status).toBe(400);
  });

  it("answers via n8n and returns answer + sources", async () => {
    dbMock.setResult([{ id: "c1" }]); // ownership + inserts resolve to this
    const res = await request(app())
      .post("/chat/conversations/c1/messages")
      .send({ question: "What is the answer?" });
    expect(res.status).toBe(200);
    expect(res.body.answer).toBe("42");
    expect(res.body.sources[0].filename).toBe("doc.pdf");
  });

  it("returns 404 when the conversation is not owned", async () => {
    dbMock.setResult([]); // ownership lookup empty
    const res = await request(app())
      .post("/chat/conversations/cX/messages")
      .send({ question: "hi" });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it and watch the new cases fail**

Run: `cd backend && npx vitest run src/rag/chat-routes.test.ts`
Expected: FAIL — route returns 404 (no such route) for the message POST.

- [ ] **Step 3: Implement the route** — add to `backend/src/rag/chat-routes.ts` (import additions + route)

Add to the imports at the top:

```typescript
import { queryRag } from "./n8n-client.js";
```

Add before `export { router as chatRouter, ... }`:

```typescript
const askSchema = z.object({ question: z.string().trim().min(1) });

router.post(
  "/conversations/:id/messages",
  requireCsrf,
  async (req: Request, res: Response) => {
    const userId = req.session.userId as string;
    const owned = await ownedConversation(userId, req.params.id);
    if (!owned) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const parsed = askSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "A non-empty question is required" });
      return;
    }
    const { question } = parsed.data;

    // Persist the user's message first.
    await db.insert(messages).values({
      conversationId: req.params.id,
      role: "user",
      content: question,
    });

    let result;
    try {
      result = await queryRag(req.params.id, question);
    } catch {
      res.status(502).json({ error: "The assistant is unavailable right now" });
      return;
    }

    // Persist the assistant answer with its sources.
    await db.insert(messages).values({
      conversationId: req.params.id,
      role: "assistant",
      content: result.answer,
      sources: result.sources,
    });

    res.json({ answer: result.answer, sources: result.sources });
  },
);
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd backend && npx vitest run src/rag/chat-routes.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add backend/src/rag/chat-routes.ts backend/src/rag/chat-routes.test.ts
git commit -m "add ask-a-question route that proxies to n8n and persists the turn"
```

---

### Task 7: Attachment upload route (multipart → n8n ingest)

**Files:**
- Modify: `backend/src/rag/chat-routes.ts` (add upload route + multer)
- Modify: `backend/src/rag/chat-routes.test.ts` (add cases)

**Interfaces:**
- Produces: `POST /conversations/:id/attachments` (multipart field `file`) → 202 `{ attachmentId, status, chunkCount }`.
- Consumes: `ingestFile` (`./n8n-client.js`), `multer`, `attachments` table.

- [ ] **Step 1: Add failing test cases** to `backend/src/rag/chat-routes.test.ts`

Add to the n8n mock factory (replace the existing `vi.mock("./n8n-client.js", ...)` with one that also stubs `ingestFile`):

```typescript
vi.mock("./n8n-client.js", () => ({
  queryRag: vi.fn(async () => ({
    answer: "42",
    sources: [{ filename: "doc.pdf", chunkIndex: 1, text: "the answer is 42" }],
  })),
  ingestFile: vi.fn(async () => ({ status: "ok", chunkCount: 3 })),
}));
```

Add a describe block:

```typescript
describe("attachment route", () => {
  it("rejects a non-PDF/DOCX file with 400", async () => {
    dbMock.setResult([{ id: "c1" }]); // owned
    const res = await request(app())
      .post("/chat/conversations/c1/attachments")
      .attach("file", Buffer.from("hello"), {
        filename: "notes.txt",
        contentType: "text/plain",
      });
    expect(res.status).toBe(400);
  });

  it("accepts a PDF and returns 202 with a chunk count", async () => {
    dbMock.setResult([{ id: "att1" }]); // ownership + insert returning
    const res = await request(app())
      .post("/chat/conversations/c1/attachments")
      .attach("file", Buffer.from("%PDF-1.4 fake"), {
        filename: "doc.pdf",
        contentType: "application/pdf",
      });
    expect(res.status).toBe(202);
    expect(res.body.chunkCount).toBe(3);
  });
});
```

- [ ] **Step 2: Run it and watch the new cases fail**

Run: `cd backend && npx vitest run src/rag/chat-routes.test.ts`
Expected: FAIL — attachment route returns 404.

- [ ] **Step 3: Implement the upload route** — add to `backend/src/rag/chat-routes.ts`

Add imports at the top:

```typescript
import multer from "multer";
import { ingestFile } from "./n8n-client.js";
import { attachments } from "../db/schema.js";
```

Add after the router is created:

```typescript
// 20 MB cap; keep the file in memory so we can forward it to n8n.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
```

Add the route before the `export`:

```typescript
router.post(
  "/conversations/:id/attachments",
  requireCsrf,
  upload.single("file"),
  async (req: Request, res: Response) => {
    const userId = req.session.userId as string;
    const owned = await ownedConversation(userId, req.params.id);
    if (!owned) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const file = req.file;
    if (!file || !ALLOWED_MIME.has(file.mimetype)) {
      res.status(400).json({ error: "Only PDF and DOCX files are supported" });
      return;
    }

    let result;
    try {
      result = await ingestFile(
        req.params.id,
        file.originalname,
        file.buffer,
        file.mimetype,
      );
    } catch {
      res.status(502).json({ error: "Indexing is unavailable right now" });
      return;
    }

    const rows = await db
      .insert(attachments)
      .values({
        conversationId: req.params.id,
        filename: file.originalname,
        status: "ready",
        chunkCount: result.chunkCount,
      })
      .returning({ id: attachments.id });

    res.status(202).json({
      attachmentId: rows[0].id,
      status: "ready",
      chunkCount: result.chunkCount,
    });
  },
);
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd backend && npx vitest run src/rag/chat-routes.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add backend/src/rag/chat-routes.ts backend/src/rag/chat-routes.test.ts backend/package.json backend/package-lock.json
git commit -m "add attachment upload route that forwards files to n8n ingestion"
```

---

### Task 8: Mount the chat router

**Files:**
- Modify: `backend/src/server.ts` (mount router)

**Interfaces:**
- Consumes: `chatRouter` (Task 5).

- [ ] **Step 1: Mount the router** in `backend/src/server.ts`

Add the import near the other route import:

```typescript
import { chatRouter } from "./rag/chat-routes.js";
```

Add the mount right after `app.use("/auth", authRoutes);`:

```typescript
app.use("/chat", chatRouter);
```

- [ ] **Step 2: Typecheck and run the full backend test suite**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: typecheck clean; all tests pass.

- [ ] **Step 3: Smoke-test the route wiring locally**

Run (with the dev DB up): `cd backend && npm run dev`, then in another shell:
```bash
curl -s -i http://localhost:4000/chat/conversations
```
Expected: `401 Unauthorized` (auth guard active, route mounted).

- [ ] **Step 4: Commit**

```bash
git add backend/src/server.ts
git commit -m "mount the chat router on the backend"
```

---

### Task 9: n8n — Qdrant collection + ingestion workflow

> n8n workflows are built in the n8n editor (or via the n8n MCP tools) and verified by execution, not by unit tests. Build credentials first: an **OpenAI** credential (embeddings), a **Qdrant** credential (URL `http://qdrant:6333` on the stack network), and an **Anthropic** credential (used in Task 10).

**Prereqs:** the deployed stack (Postgres, Qdrant, n8n) is running and n8n is reachable.

- [ ] **Step 1: Create the Qdrant collection**

In the n8n Qdrant node (or via a one-off HTTP call from the n8n host), create collection `chat_attachments` with vector size **1536** and distance **Cosine**. Verify:
```bash
curl -s http://127.0.0.1:6333/collections/chat_attachments
```
Expected: JSON describing the collection with `"size": 1536` and `"distance": "Cosine"`.

- [ ] **Step 2: Build the ingestion workflow** with these nodes in order:
  1. **Webhook** — method POST, path `rag-ingest`, responds via a "Respond to Webhook" node. Accepts a binary `file` field + a `conversationId` field.
  2. **Extract from File** — operation: extract text; handles PDF and DOCX from the binary `file`.
  3. **Code (chunk)** — split the extracted text into ~800-token chunks with ~100 token overlap; output one item per chunk carrying `{ text, chunkIndex, conversationId, filename }`.
  4. **Embeddings OpenAI** — model `text-embedding-3-small`.
  5. **Qdrant Vector Store (insert)** — collection `chat_attachments`; store the embedding with payload `{ conversationId, filename, chunkIndex, text }`.
  6. **Respond to Webhook** — body `{ "status": "ok", "chunkCount": {{ number of chunks }} }`.

- [ ] **Step 3: Validate and activate**

Validate the workflow (n8n editor "Test workflow", or the MCP `validate_workflow`). Fix errors until valid. Activate it so the production webhook URL `/.../webhook/rag-ingest` is live.

- [ ] **Step 4: Manual verification**

POST a small text-based PDF to the webhook:
```bash
curl -s -F "conversationId=test-conv" -F "file=@sample.pdf" http://127.0.0.1:5678/webhook/rag-ingest
```
Expected: `{"status":"ok","chunkCount":N}` with N > 0. Then confirm points landed:
```bash
curl -s -X POST http://127.0.0.1:6333/collections/chat_attachments/points/scroll \
  -H 'content-type: application/json' -d '{"limit":3,"with_payload":true}'
```
Expected: points whose payload includes `conversationId: "test-conv"`.

- [ ] **Step 5: Export the workflow JSON into the repo for version control**

Save the workflow export to `n8n/workflows/rag-ingest.json` and commit:
```bash
git add n8n/workflows/rag-ingest.json
git commit -m "add n8n ingestion workflow export"
```

---

### Task 10: n8n — RAG query workflow

- [ ] **Step 1: Build the query workflow** with these nodes:
  1. **Webhook** — POST, path `rag-query`, accepts `{ conversationId, question }`.
  2. **Embeddings OpenAI** — `text-embedding-3-small`; embed `question`.
  3. **Qdrant Vector Store (search)** — collection `chat_attachments`, top-K **5**, filter `conversationId == {{ $json.conversationId }}`.
  4. **Code (build prompt)** — assemble the retrieved chunk texts into a context block; carry the chunks for the response sources.
  5. **Anthropic Chat Model** — model `claude-sonnet-4-6`. System: "Answer the question using ONLY the provided context. If the answer is not in the context, say you couldn't find it in the document. Be concise." User: the context block + the question.
  6. **Respond to Webhook** — body `{ "answer": "{{ model output }}", "sources": [ {filename, chunkIndex, text} for each retrieved chunk ] }`.

- [ ] **Step 2: Validate and activate**

Validate (fix errors until clean) and activate so `/.../webhook/rag-query` is live.

- [ ] **Step 3: Manual verification** (uses the points ingested in Task 9)

```bash
curl -s -X POST http://127.0.0.1:5678/webhook/rag-query \
  -H 'content-type: application/json' \
  -d '{"conversationId":"test-conv","question":"<a question answerable from sample.pdf>"}'
```
Expected: `{"answer":"...","sources":[{"filename":"sample.pdf","chunkIndex":...,"text":"..."}]}` with a correct, grounded answer. Then ask an out-of-document question and confirm the answer says it couldn't find it.

- [ ] **Step 4: Export + commit**

```bash
git add n8n/workflows/rag-query.json
git commit -m "add n8n rag query workflow export"
```

---

### Task 11: Frontend — chat API module

**Files:**
- Create: `frontend/app/(main)/chat/rag-api.ts`

**Interfaces:**
- Produces:
  - `createConversation(): Promise<{ id: string; title: string; createdAt: string }>`
  - `listConversations(): Promise<Conversation[]>`
  - `listMessages(conversationId): Promise<ChatMessage[]>`
  - `uploadAttachment(conversationId, file: File): Promise<{ attachmentId: string; status: string; chunkCount: number }>`
  - `askQuestion(conversationId, question): Promise<{ answer: string; sources: Source[] }>`
- Consumes: `apiClient` (`@/lib/api`) — the axios instance that already attaches the CSRF header on mutating calls and sends the session cookie.

- [ ] **Step 1: Create `frontend/app/(main)/chat/rag-api.ts`**

```typescript
import { apiClient } from '@/lib/api';

export interface Source {
  filename: string;
  chunkIndex: number;
  text: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: Source[] | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
}

export async function createConversation(): Promise<Conversation> {
  const { data } = await apiClient.post<Conversation>('/chat/conversations', {});
  return data;
}

export async function listConversations(): Promise<Conversation[]> {
  const { data } = await apiClient.get<Conversation[]>('/chat/conversations');
  return data;
}

export async function listMessages(conversationId: string): Promise<ChatMessage[]> {
  const { data } = await apiClient.get<ChatMessage[]>(
    `/chat/conversations/${conversationId}/messages`,
  );
  return data;
}

export async function uploadAttachment(
  conversationId: string,
  file: File,
): Promise<{ attachmentId: string; status: string; chunkCount: number }> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await apiClient.post(
    `/chat/conversations/${conversationId}/attachments`,
    form,
  );
  return data;
}

export async function askQuestion(
  conversationId: string,
  question: string,
): Promise<{ answer: string; sources: Source[] }> {
  const { data } = await apiClient.post(
    `/chat/conversations/${conversationId}/messages`,
    { question },
  );
  return data;
}
```

- [ ] **Step 2: Add the backend proxy path to the same-origin proxy** — in `frontend/next.config.mjs`, add to the `beforeFiles` array (so `/chat/*` reaches the VPS backend like `/auth/*` does):

```javascript
                { source: '/chat/:path*', destination: `${backendOrigin}/chat/:path*` },
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors in `rag-api.ts`.

- [ ] **Step 4: Commit**

```bash
git add "frontend/app/(main)/chat/rag-api.ts" frontend/next.config.mjs
git commit -m "add frontend rag chat api module and proxy the chat path"
```

---

### Task 12: Frontend — wire the chat view (non-streaming)

**Files:**
- Modify: the chat page component under `frontend/app/(main)/chat/` (the message-send + attach handlers and the message render)

**Interfaces:**
- Consumes: `rag-api.ts` (Task 11).

> The existing chat page is wired to dead `/api/v1` + SSE. This task replaces only the data path for send + attach with the new non-streaming calls and renders a Sources list. Keep the existing visual shell.

- [ ] **Step 1: Locate the send + attachment handlers**

Run: `grep -rn "streaming\|/api/v1\|onSend\|handleSend\|attach" "frontend/app/(main)/chat/"`
Identify the message-send handler and the file-attach handler in the chat page.

- [ ] **Step 2: Replace the send handler** to use `askQuestion`

Replace the SSE/streaming send path with: on submit, ensure a conversation exists (call `createConversation()` once and keep the id in state if none), append the user message to local state, set a `pending` flag, then:

```typescript
const { answer, sources } = await askQuestion(conversationId, question);
setMessages((prev) => [
  ...prev,
  { id: crypto.randomUUID(), role: 'assistant', content: answer, sources, createdAt: new Date().toISOString() },
]);
setPending(false);
```

Show a "Thinking…" indicator while `pending` is true.

- [ ] **Step 3: Replace the attach handler** to use `uploadAttachment`

On file pick: set an `indexing` flag, call `await uploadAttachment(conversationId, file)`, then clear the flag and show "Ready — ask a question about <filename>." On error, show "Indexing failed."

- [ ] **Step 4: Render the Sources list** under each assistant message

```tsx
{message.role === 'assistant' && message.sources && message.sources.length > 0 && (
  <div className="sources">
    <span>Sources</span>
    <ul>
      {message.sources.map((s, i) => (
        <li key={i}>
          {s.filename} — {s.text.slice(0, 120)}…
        </li>
      ))}
    </ul>
  </div>
)}
```

- [ ] **Step 5: Typecheck + run the dev server**

Run: `cd frontend && npx tsc --noEmit` (expect clean), then `npm run dev`.

- [ ] **Step 6: Commit**

```bash
git add "frontend/app/(main)/chat/"
git commit -m "wire the chat view to the non-streaming rag backend"
```

---

### Task 13: End-to-end verification

**Files:** none (manual acceptance against the success criteria in the spec §1).

- [ ] **Step 1: Bring everything up**

Backend + n8n + Qdrant running (deployed stack), both n8n workflows active, frontend `npm run dev` on `localhost:3000` pointed at the backend.

- [ ] **Step 2: Happy path**

Log in → start a chat → attach a known text-based PDF → wait for "Ready" → ask a question whose answer is in the PDF.
Expected: a correct answer appears (non-streaming) with a Sources list naming the PDF.

- [ ] **Step 3: Negative path (no hallucination)**

Ask a question whose answer is NOT in the document.
Expected: the assistant says it couldn't find it in the document.

- [ ] **Step 4: Persistence**

Refresh the page and reopen the conversation.
Expected: the prior messages reload from `GET /conversations/:id/messages`.

- [ ] **Step 5: Isolation**

Start a second conversation, attach a different document, ask a question answerable only from the first conversation's document.
Expected: the second chat does NOT surface the first chat's content (Qdrant `conversationId` filter works).

- [ ] **Step 6: Final commit (if any wiring tweaks were needed)**

```bash
git add -A
git commit -m "finalize rag chat slice 1 end-to-end"
```

---

## Self-Review

**Spec coverage:** §1 goal → Tasks 9–13. §3 data flow → Tasks 3,5–10. §4 components A/B → Tasks 9/10; C → Tasks 3,5–8; D → Tasks 11–12. §5 data model → Tasks 2 (Postgres) + 9 (Qdrant). §6 API contracts → Tasks 5–7,11. §7 error handling → 400/502 cases in Tasks 6–7, no-context in Task 10. §9 testing → unit tests Tasks 3,5–7; manual Tasks 9,10,13. §10 risks: n8n binary handling verified in Task 9 Step 4 (fallback if awkward: backend extracts text and `ingestFile` sends text instead).

**Placeholders:** none — every code step shows complete code; n8n tasks list exact nodes, config, and verification commands.

**Type consistency:** `QuerySource`/`Source` shape `{filename, chunkIndex, text}` is identical across n8n-client, chat-routes, rag-api, and the workflows. `queryRag`/`ingestFile` signatures match between Task 3 (definition) and Tasks 6–7 (use).
