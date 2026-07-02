# Persistent Vector Library — Phase 1 (Upload) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, shared, admin-curated document library where uploaded files are indexed into Qdrant by the backend and searched at query time to enrich the existing n8n `RAG Query` answer.

**Architecture:** The backend is the sole driver of Qdrant — it extracts text via the live n8n `RAG Read` webhook, chunks + embeds (OpenAI `text-embedding-3-small`) in-process, and upserts to the `project_rag_library` collection. On a chat message it gates on intent, searches the collection, and passes the hits to `rag-query` as a new `libraryDocs` field. n8n and Qdrant never talk directly.

**Tech Stack:** TypeScript, Express, Drizzle ORM (Postgres), `@langchain/qdrant`, `@langchain/openai`, `@langchain/textsplitters`, multer, vitest. n8n (unchanged behavior aside from one additive edit).

## Global Constraints

- **Never import from `backend/src-langchain/`.** All new code lives under `backend/src/`. Text extraction uses the live n8n `RAG Read` webhook, not `src-langchain`.
- Reuse npm packages already in `backend/package.json`: `@langchain/qdrant ^1.0.3`, `@langchain/openai ^1.5.3`, `@langchain/textsplitters ^1.0.1`, `@langchain/core ^1.2.1`, `multer ^2.2.0`.
- Embedding model: OpenAI `text-embedding-3-small` (1536 dims), via `config.OPENAI_API_KEY` + `config.EMBED_MODEL`.
- Qdrant collection name: `config.QDRANT_COLLECTION_LIBRARY` (default `project_rag_library`); URL `config.QDRANT_URL`.
- Library write/management routes are admin-only (`requireAuth` + `requireAdmin` + `requireCsrf`), mounted under `/library`.
- Chunking: `chunkSize: 1000`, `chunkOverlap: 150`.
- Commit-message style: plain imperative, no conventional-commit prefixes, never mention "pipeshub". End commits with the Co-Authored-By trailer used in this repo.
- Run all backend commands from `backend/`. Test runner: `npx vitest run <path>`. Full suite: `npx vitest run`.
- Branch: work on `dev2`.

---

### Task 1: Clean slate — drop the src-langchain-coupled library code

Removes the abandoned Drive-sync files (they import `src-langchain`) and neutralizes their references so the tree compiles and tests pass with zero `src-langchain` coupling in the library/chat paths. Drive is rebuilt fresh in Phase 2.

**Files:**
- Delete: `backend/src/library/sync.ts`
- Delete: `backend/src/library/sync.test.ts`
- Delete: `backend/src/library/diff.ts`
- Delete: `backend/src/library/diff.test.ts`
- Modify: `backend/src/library/routes.ts` (remove `/sync` + `runSync` import)
- Modify: `backend/src/rag/chat-routes.ts:308-321` (remove `queryLibrary` branch)

**Interfaces:**
- Consumes: nothing new.
- Produces: a `/library` router exposing only `GET /status`; a chat ask-path that always calls `queryRag` (the `useLibrary` flag becomes a temporary no-op, re-wired in Task 11).

- [ ] **Step 1: Delete the four stale files**

```bash
cd backend
git rm src/library/sync.ts src/library/sync.test.ts src/library/diff.ts src/library/diff.test.ts
```

- [ ] **Step 2: Simplify `src/library/routes.ts`**

Replace the whole file with:

```ts
import { Router, type Request, type Response } from "express";
import { requireAuth, requireAdmin } from "../auth/middleware.js";
import { summary } from "./repo.js";

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

// Report library index state (counts + last index time) for the admin UI.
router.get("/status", async (_req: Request, res: Response) => {
  res.json(await summary());
});

export { router as libraryRouter };
```

- [ ] **Step 3: Remove the `queryLibrary` branch in `src/rag/chat-routes.ts`**

Find the block (around lines 308-321):

```ts
    let result: QueryResult;
    try {
      if (useLibrary) {
        const { queryLibrary } = await import("../../src-langchain/library/query.js");
        result = await queryLibrary(question, history);
      } else {
        result = await queryRag(req.params.id, question, history, isFirstMessage);
      }
    } catch {
```

Replace it with:

```ts
    let result: QueryResult;
    try {
      result = await queryRag(req.params.id, question, history, isFirstMessage);
    } catch {
```

Leave `useLibrary` destructured from `parsed.data` (unused for now; Task 11 re-wires it). To satisfy the linter, change `const { question, useLibrary } = parsed.data;` to `const { question } = parsed.data;` for now — Task 11 restores `useLibrary`.

- [ ] **Step 4: Run the full suite to confirm nothing else referenced the deleted code**

Run: `cd backend && npx vitest run`
Expected: PASS (no references to `sync`/`diff`/`queryLibrary` remain; `library/routes.test.ts` may test `/status` only — if it references `/sync`, delete those cases now).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Remove abandoned src-langchain Drive-sync library code

Clears the way for a backend-owned vector library. Drops sync.ts/diff.ts
and the queryLibrary branch; the /library router keeps only /status.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Generalize the `library_documents` schema + repo

The current table is keyed on `drive_file_id` (Drive-only). Uploads have no Drive id, so generalize to a uuid `id` with a `source`/`source_ref` pair. The `id` doubles as the Qdrant `sourceId`.

**Files:**
- Modify: `backend/src/db/schema.ts:84-101`
- Rewrite: `backend/src/library/repo.ts`
- Rewrite: `backend/src/library/repo.test.ts`

**Interfaces:**
- Produces:
  - `insertDocument(row: NewLibraryDocument): Promise<string>` — inserts, returns the new `id`.
  - `updateDocument(id: string, patch: Partial<NewLibraryDocument>): Promise<void>`
  - `listIndexed(): Promise<LibraryDocument[]>`
  - `deleteDocument(id: string): Promise<void>`
  - `summary(): Promise<{ total: number; failed: number; lastIndexedAt: string | null }>`
  - Types `LibraryDocument`, `NewLibraryDocument` from `db/schema.ts`.

- [ ] **Step 1: Write the failing repo test**

Replace `backend/src/library/repo.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeDbMock } from "../test/app-harness.js";

const { db, setResult } = makeDbMock();
vi.mock("../db/index.js", () => ({ db }));

const { insertDocument, updateDocument, deleteDocument, listIndexed, summary } =
  await import("./repo.js");

describe("library repo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("insertDocument returns the new id", async () => {
    setResult([{ id: "doc-1" }]);
    const id = await insertDocument({
      source: "upload",
      sourceRef: null,
      filename: "a.pdf",
      mimeType: "application/pdf",
      chunkCount: 0,
      status: "indexing",
    });
    expect(id).toBe("doc-1");
  });

  it("listIndexed returns rows", async () => {
    setResult([{ id: "doc-1", filename: "a.pdf" }]);
    const rows = await listIndexed();
    expect(rows).toHaveLength(1);
  });

  it("summary returns the aggregate row", async () => {
    setResult([{ total: 3, failed: 1, lastIndexedAt: "2026-07-03T00:00:00Z" }]);
    const s = await summary();
    expect(s.total).toBe(3);
    expect(s.failed).toBe(1);
  });

  it("updateDocument and deleteDocument run without throwing", async () => {
    setResult([]);
    await expect(updateDocument("doc-1", { status: "indexed" })).resolves.toBeUndefined();
    await expect(deleteDocument("doc-1")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend && npx vitest run src/library/repo.test.ts`
Expected: FAIL (repo.ts still exposes the old Drive-keyed API / `insertDocument` undefined).

- [ ] **Step 3: Update the schema**

In `backend/src/db/schema.ts`, replace the `libraryDocuments` block (lines 84-101) with:

```ts
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
```

(`uuid`, `text`, `integer`, `timestamp`, `pgTable` are already imported at the top of the file.)

- [ ] **Step 4: Rewrite `src/library/repo.ts`**

```ts
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { libraryDocuments } from "../db/schema.js";
import type { LibraryDocument, NewLibraryDocument } from "../db/schema.js";

export async function insertDocument(row: NewLibraryDocument): Promise<string> {
  const inserted = await db
    .insert(libraryDocuments)
    .values(row)
    .returning({ id: libraryDocuments.id });
  return inserted[0].id;
}

export async function updateDocument(
  id: string,
  patch: Partial<NewLibraryDocument>,
): Promise<void> {
  await db.update(libraryDocuments).set(patch).where(eq(libraryDocuments.id, id));
}

export async function listIndexed(): Promise<LibraryDocument[]> {
  return db.select().from(libraryDocuments);
}

export async function deleteDocument(id: string): Promise<void> {
  await db.delete(libraryDocuments).where(eq(libraryDocuments.id, id));
}

export async function summary(): Promise<{
  total: number;
  failed: number;
  lastIndexedAt: string | null;
}> {
  const rows = await db
    .select({
      total: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where ${libraryDocuments.status} = 'failed')::int`,
      lastIndexedAt: sql<string | null>`max(${libraryDocuments.indexedAt})`,
    })
    .from(libraryDocuments);
  return rows[0];
}
```

- [ ] **Step 5: Run the repo test to verify it passes**

Run: `cd backend && npx vitest run src/library/repo.test.ts`
Expected: PASS

- [ ] **Step 6: Generate and apply the migration**

Run:
```bash
cd backend
npx drizzle-kit generate
npx tsx src/db/migrate.ts
```
Expected: a new migration file under the drizzle output dir; migrate prints success. (If a local Postgres isn't running, note that migrate must be run in the deploy environment; the generate step must still succeed and be committed.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Generalize library_documents to source-agnostic uuid key

Replaces the Drive-only drive_file_id primary key with a uuid id plus
source/source_ref, so uploads (no Drive id) fit. Repo exposes insert/
update/list/delete/summary keyed on id.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `chunker.ts`

**Files:**
- Create: `backend/src/library/chunker.ts`
- Test: `backend/src/library/chunker.test.ts`

**Interfaces:**
- Produces: `chunkText(text: string): Promise<string[]>` — empty/whitespace → `[]`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { chunkText } from "./chunker.js";

describe("chunkText", () => {
  it("returns [] for empty or whitespace input", async () => {
    expect(await chunkText("")).toEqual([]);
    expect(await chunkText("   \n  ")).toEqual([]);
  });

  it("returns a single chunk for short text", async () => {
    const chunks = await chunkText("hello world");
    expect(chunks).toEqual(["hello world"]);
  });

  it("splits long text into multiple chunks", async () => {
    const long = "word ".repeat(600); // ~3000 chars > 1000
    const chunks = await chunkText(long);
    expect(chunks.length).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run src/library/chunker.test.ts`
Expected: FAIL ("Cannot find module './chunker.js'").

- [ ] **Step 3: Implement `chunker.ts`**

```ts
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 150,
});

export async function chunkText(text: string): Promise<string[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return splitter.splitText(trimmed);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/library/chunker.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/library/chunker.ts src/library/chunker.test.ts
git commit -m "Add library text chunker (1000/150 recursive splitter)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `embeddings.ts`

**Files:**
- Create: `backend/src/library/embeddings.ts`
- Test: `backend/src/library/embeddings.test.ts`

**Interfaces:**
- Produces: `makeEmbeddings(): OpenAIEmbeddings` — throws if `OPENAI_API_KEY` missing.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../config.js", () => ({
  config: { OPENAI_API_KEY: "sk-test", EMBED_MODEL: "text-embedding-3-small" },
}));

const { makeEmbeddings } = await import("./embeddings.js");

describe("makeEmbeddings", () => {
  it("builds an embeddings client using the configured model", () => {
    const emb = makeEmbeddings();
    expect(emb.model).toBe("text-embedding-3-small");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run src/library/embeddings.test.ts`
Expected: FAIL ("Cannot find module './embeddings.js'").

- [ ] **Step 3: Implement `embeddings.ts`**

```ts
import { OpenAIEmbeddings } from "@langchain/openai";
import { config } from "../config.js";

export function makeEmbeddings(): OpenAIEmbeddings {
  if (!config.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for library embeddings");
  }
  return new OpenAIEmbeddings({
    apiKey: config.OPENAI_API_KEY,
    model: config.EMBED_MODEL,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/library/embeddings.test.ts`
Expected: PASS

- [ ] **Step 5: Add and run the missing-key test**

Append to `embeddings.test.ts`:

```ts
describe("makeEmbeddings without a key", () => {
  it("throws a clear error", async () => {
    vi.resetModules();
    vi.doMock("../config.js", () => ({ config: { EMBED_MODEL: "text-embedding-3-small" } }));
    const mod = await import("./embeddings.js");
    expect(() => mod.makeEmbeddings()).toThrow(/OPENAI_API_KEY/);
  });
});
```

Run: `cd backend && npx vitest run src/library/embeddings.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/library/embeddings.ts src/library/embeddings.test.ts
git commit -m "Add OpenAI embeddings factory for the library

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `vector-store.ts`

**Files:**
- Create: `backend/src/library/vector-store.ts`
- Test: `backend/src/library/vector-store.test.ts`

**Interfaces:**
- Consumes: `makeEmbeddings` (Task 4).
- Produces:
  - `type LibraryHit = { filename: string; chunkIndex: number; text: string; score: number }`
  - `upsertChunks(sourceId: string, filename: string, source: string, chunks: string[]): Promise<void>`
  - `search(question: string, k: number): Promise<LibraryHit[]>`
  - `deleteBySource(sourceId: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config.js", () => ({
  config: { QDRANT_URL: "http://qdrant:6333", QDRANT_COLLECTION_LIBRARY: "lib" },
}));
vi.mock("./embeddings.js", () => ({ makeEmbeddings: () => ({}) }));

const addDocuments = vi.fn(async () => {});
const ensureCollection = vi.fn(async () => {});
const similaritySearchWithScore = vi.fn(async () => [
  [{ pageContent: "chunk a", metadata: { filename: "a.pdf", chunkIndex: 0 } }, 0.9],
]);
const clientDelete = vi.fn(async () => {});

vi.mock("@langchain/qdrant", () => ({
  QdrantVectorStore: class {
    client = { delete: clientDelete };
    addDocuments = addDocuments;
    ensureCollection = ensureCollection;
    similaritySearchWithScore = similaritySearchWithScore;
  },
}));

const { upsertChunks, search, deleteBySource } = await import("./vector-store.js");

describe("library vector-store", () => {
  beforeEach(() => vi.clearAllMocks());

  it("upsertChunks embeds and adds one document per chunk", async () => {
    await upsertChunks("doc-1", "a.pdf", "upload", ["chunk a", "chunk b"]);
    expect(ensureCollection).toHaveBeenCalled();
    const docs = addDocuments.mock.calls[0][0];
    expect(docs).toHaveLength(2);
    expect(docs[0].metadata).toMatchObject({ sourceId: "doc-1", filename: "a.pdf", chunkIndex: 0, source: "upload" });
  });

  it("upsertChunks is a no-op for empty chunks", async () => {
    await upsertChunks("doc-1", "a.pdf", "upload", []);
    expect(addDocuments).not.toHaveBeenCalled();
  });

  it("search maps results to hits with scores", async () => {
    const hits = await search("q", 8);
    expect(hits[0]).toEqual({ filename: "a.pdf", chunkIndex: 0, text: "chunk a", score: 0.9 });
  });

  it("deleteBySource filters on the sourceId payload", async () => {
    await deleteBySource("doc-1");
    expect(clientDelete).toHaveBeenCalledWith("lib", {
      filter: { must: [{ key: "metadata.sourceId", match: { value: "doc-1" } }] },
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run src/library/vector-store.test.ts`
Expected: FAIL ("Cannot find module './vector-store.js'").

- [ ] **Step 3: Implement `vector-store.ts`**

```ts
import { QdrantVectorStore } from "@langchain/qdrant";
import { Document } from "@langchain/core/documents";
import { config } from "../config.js";
import { makeEmbeddings } from "./embeddings.js";

export type LibraryHit = {
  filename: string;
  chunkIndex: number;
  text: string;
  score: number;
};

// Construct a store per call (no memoization) so behavior is easy to reason
// about and to test. ensureCollection creates the collection (with the
// embedding's dimensions) if it does not yet exist.
async function getStore(): Promise<QdrantVectorStore> {
  if (!config.QDRANT_URL) {
    throw new Error("QDRANT_URL is required for the library");
  }
  const store = new QdrantVectorStore(makeEmbeddings(), {
    url: config.QDRANT_URL,
    collectionName: config.QDRANT_COLLECTION_LIBRARY,
  });
  await store.ensureCollection();
  return store;
}

export async function upsertChunks(
  sourceId: string,
  filename: string,
  source: string,
  chunks: string[],
): Promise<void> {
  if (chunks.length === 0) return;
  const store = await getStore();
  const docs = chunks.map(
    (content, chunkIndex) =>
      new Document({
        pageContent: content,
        metadata: { sourceId, filename, chunkIndex, source },
      }),
  );
  await store.addDocuments(docs);
}

export async function search(question: string, k: number): Promise<LibraryHit[]> {
  const store = await getStore();
  const results = await store.similaritySearchWithScore(question, k);
  return results.map(([doc, score]) => ({
    filename: String(doc.metadata?.filename ?? ""),
    chunkIndex: Number(doc.metadata?.chunkIndex ?? 0),
    text: doc.pageContent,
    score,
  }));
}

export async function deleteBySource(sourceId: string): Promise<void> {
  const store = await getStore();
  await store.client.delete(config.QDRANT_COLLECTION_LIBRARY, {
    filter: { must: [{ key: "metadata.sourceId", match: { value: sourceId } }] },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/library/vector-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/library/vector-store.ts src/library/vector-store.test.ts
git commit -m "Add Qdrant library vector store (upsert/search/delete by source)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `text-extract.ts` (reuse the live n8n RAG Read webhook)

**Files:**
- Create: `backend/src/library/text-extract.ts`
- Test: `backend/src/library/text-extract.test.ts`

**Interfaces:**
- Produces: `extractText(file: Buffer, filename: string, mimeType: string): Promise<string>`.

The `RAG Read` webhook (`POST {N8N_BASE_URL}/webhook/rag-read`) takes a multipart body with a `file` binary and a `filename` field, and responds `{ text }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config.js", () => ({ config: { N8N_BASE_URL: "http://n8n:5678" } }));

const { extractText } = await import("./text-extract.js");

describe("extractText", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POSTs to the rag-read webhook and returns the text", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ text: "hello" }), { status: 200 }));
    const text = await extractText(Buffer.from("x"), "a.pdf", "application/pdf");
    expect(text).toBe("hello");
    expect(fetchMock.mock.calls[0][0]).toBe("http://n8n:5678/webhook/rag-read");
  });

  it("throws on a non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 502 }));
    await expect(extractText(Buffer.from("x"), "a.pdf", "application/pdf")).rejects.toThrow(/rag-read/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run src/library/text-extract.test.ts`
Expected: FAIL ("Cannot find module './text-extract.js'").

- [ ] **Step 3: Implement `text-extract.ts`**

```ts
import { config } from "../config.js";

const READ_PATH = "/webhook/rag-read";

export async function extractText(
  file: Buffer,
  filename: string,
  mimeType: string,
): Promise<string> {
  const url = `${config.N8N_BASE_URL.replace(/\/$/, "")}${READ_PATH}`;
  const form = new FormData();
  form.append("filename", filename);
  form.append("file", new Blob([file], { type: mimeType }), filename);

  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`n8n rag-read failed: ${res.status}`);
  }
  const data = (await res.json()) as { text?: string };
  return typeof data.text === "string" ? data.text : "";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/library/text-extract.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/library/text-extract.ts src/library/text-extract.test.ts
git commit -m "Add library text extraction via the live n8n RAG Read webhook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `ingest.ts` (the shared indexing pipeline)

**Files:**
- Create: `backend/src/library/ingest.ts`
- Test: `backend/src/library/ingest.test.ts`

**Interfaces:**
- Consumes: `extractText` (T6), `chunkText` (T3), `upsertChunks`/`deleteBySource` (T5), `insertDocument`/`updateDocument` (T2).
- Produces: `indexUpload(filename: string, mimeType: string, file: Buffer): Promise<{ id: string; status: "indexed" | "failed"; chunkCount: number }>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const insertDocument = vi.fn(async () => "doc-1");
const updateDocument = vi.fn(async () => {});
vi.mock("./repo.js", () => ({ insertDocument, updateDocument }));

const extractText = vi.fn(async () => "some text");
vi.mock("./text-extract.js", () => ({ extractText }));

const chunkText = vi.fn(async () => ["c1", "c2"]);
vi.mock("./chunker.js", () => ({ chunkText }));

const upsertChunks = vi.fn(async () => {});
const deleteBySource = vi.fn(async () => {});
vi.mock("./vector-store.js", () => ({ upsertChunks, deleteBySource }));

const { indexUpload } = await import("./ingest.js");

describe("indexUpload", () => {
  beforeEach(() => vi.clearAllMocks());

  it("indexes a document and reports chunk count", async () => {
    const r = await indexUpload("a.pdf", "application/pdf", Buffer.from("x"));
    expect(r).toEqual({ id: "doc-1", status: "indexed", chunkCount: 2 });
    expect(deleteBySource).toHaveBeenCalledWith("doc-1");
    expect(upsertChunks).toHaveBeenCalledWith("doc-1", "a.pdf", "upload", ["c1", "c2"]);
    expect(updateDocument).toHaveBeenCalledWith("doc-1", { status: "indexed", chunkCount: 2, lastError: null });
  });

  it("marks the row failed and stores no vectors when no text is extracted", async () => {
    chunkText.mockResolvedValueOnce([]);
    const r = await indexUpload("a.pdf", "application/pdf", Buffer.from("x"));
    expect(r.status).toBe("failed");
    expect(upsertChunks).not.toHaveBeenCalled();
    expect(updateDocument).toHaveBeenCalledWith("doc-1", { status: "failed", chunkCount: 0, lastError: "no text extracted" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run src/library/ingest.test.ts`
Expected: FAIL ("Cannot find module './ingest.js'").

- [ ] **Step 3: Implement `ingest.ts`**

```ts
import { extractText } from "./text-extract.js";
import { chunkText } from "./chunker.js";
import { upsertChunks, deleteBySource } from "./vector-store.js";
import { insertDocument, updateDocument } from "./repo.js";

export type IngestLibraryResult = {
  id: string;
  status: "indexed" | "failed";
  chunkCount: number;
};

export async function indexUpload(
  filename: string,
  mimeType: string,
  file: Buffer,
): Promise<IngestLibraryResult> {
  const id = await insertDocument({
    source: "upload",
    sourceRef: null,
    filename,
    mimeType,
    chunkCount: 0,
    status: "indexing",
  });
  try {
    const text = await extractText(file, filename, mimeType);
    const chunks = await chunkText(text);
    if (chunks.length === 0) throw new Error("no text extracted");
    // Clear any prior vectors for this id before writing (safe re-index).
    await deleteBySource(id);
    await upsertChunks(id, filename, "upload", chunks);
    await updateDocument(id, { status: "indexed", chunkCount: chunks.length, lastError: null });
    return { id, status: "indexed", chunkCount: chunks.length };
  } catch (err) {
    const lastError = err instanceof Error ? err.message : String(err);
    await updateDocument(id, { status: "failed", chunkCount: 0, lastError });
    return { id, status: "failed", chunkCount: 0 };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/library/ingest.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/library/ingest.ts src/library/ingest.test.ts
git commit -m "Add library ingest pipeline (extract, chunk, embed, upsert, track)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `retrieve.ts` (query-time search + intent gate)

**Files:**
- Create: `backend/src/library/retrieve.ts`
- Test: `backend/src/library/retrieve.test.ts`

**Interfaces:**
- Consumes: `search` (T5), `config`.
- Produces:
  - `searchLibrary(question: string, k?: number): Promise<QuerySource[]>` — drops hits below the score threshold; default `k = 8`.
  - `shouldSearchLibrary(question: string): Promise<boolean>` — cheap LLM intent gate; returns `false` if no key.
  - `const LIBRARY_SCORE_THRESHOLD = 0.2`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config.js", () => ({
  config: { OPENAI_API_KEY: "sk-test", GENERATE_MODEL: "gpt-4o-mini" },
}));

const search = vi.fn();
vi.mock("./vector-store.js", () => ({ search }));

const invoke = vi.fn();
vi.mock("@langchain/openai", () => ({
  ChatOpenAI: class {
    invoke = invoke;
  },
}));

const { searchLibrary, shouldSearchLibrary } = await import("./retrieve.js");

describe("searchLibrary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns hits above the score threshold as QuerySource, dropping weak ones", async () => {
    search.mockResolvedValue([
      { filename: "a.pdf", chunkIndex: 0, text: "strong", score: 0.9 },
      { filename: "b.pdf", chunkIndex: 1, text: "weak", score: 0.05 },
    ]);
    const docs = await searchLibrary("q");
    expect(docs).toEqual([{ filename: "a.pdf", chunkIndex: 0, text: "strong" }]);
  });
});

describe("shouldSearchLibrary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true when the classifier says yes", async () => {
    invoke.mockResolvedValue({ content: "yes" });
    expect(await shouldSearchLibrary("what does the SOP say?")).toBe(true);
  });

  it("returns false when the classifier says no", async () => {
    invoke.mockResolvedValue({ content: "no" });
    expect(await shouldSearchLibrary("write me a poem")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run src/library/retrieve.test.ts`
Expected: FAIL ("Cannot find module './retrieve.js'").

- [ ] **Step 3: Implement `retrieve.ts`**

```ts
import { ChatOpenAI } from "@langchain/openai";
import { search } from "./vector-store.js";
import { config } from "../config.js";
import type { QuerySource } from "../rag/types.js";

// Hits below this cosine score are noise for our corpus; tune against real docs.
export const LIBRARY_SCORE_THRESHOLD = 0.2;

export async function searchLibrary(question: string, k = 8): Promise<QuerySource[]> {
  const hits = await search(question, k);
  return hits
    .filter((h) => h.score >= LIBRARY_SCORE_THRESHOLD)
    .map((h) => ({ filename: h.filename, chunkIndex: h.chunkIndex, text: h.text }));
}

const INTENT_SYSTEM =
  "You decide whether a user's message is asking about the content of a document " +
  "in a shared knowledge library. Reply with only 'yes' or 'no'. Answer 'yes' for " +
  "questions about documents, files, reports, SOPs, manuals, policies, or a " +
  "specifically named material. Answer 'no' for generic, creative, or " +
  "general-knowledge requests and small talk.";

export async function shouldSearchLibrary(question: string): Promise<boolean> {
  if (!config.OPENAI_API_KEY) return false;
  const model = new ChatOpenAI({
    apiKey: config.OPENAI_API_KEY,
    model: config.GENERATE_MODEL,
    temperature: 0,
  });
  const res = await model.invoke([
    { role: "system", content: INTENT_SYSTEM },
    { role: "user", content: question },
  ]);
  return String(res.content).toLowerCase().includes("yes");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/library/retrieve.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/library/retrieve.ts src/library/retrieve.test.ts
git commit -m "Add library query-time search and intent gate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Thread `libraryDocs` through the n8n query client + provider

**Files:**
- Modify: `backend/src/rag/n8n-client.ts:32-55`
- Modify: `backend/src/rag/provider.ts:13-23`
- Modify: `backend/src/rag/n8n-client.test.ts`

**Interfaces:**
- Produces:
  - `n8n.queryRag(conversationId, question, history?, generateTitle?, libraryDocs?: QuerySource[])` — sends `libraryDocs` in the POST body.
  - `provider.queryRag(conversationId, question, history?, generateTitle?, libraryDocs?: QuerySource[])` — forwards `libraryDocs` on the n8n path (ignored on the langgraph path).

- [ ] **Step 1: Write the failing test**

Add to `backend/src/rag/n8n-client.test.ts` (mirror the existing fetch-mock style already used there):

```ts
it("includes libraryDocs in the query body", async () => {
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify({ answer: "a", sources: [] }), { status: 200 }));
  const { queryRag } = await import("./n8n-client.js");
  await queryRag("c1", "q", [], false, [{ filename: "a.pdf", chunkIndex: 0, text: "ctx" }]);
  const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
  expect(body.libraryDocs).toEqual([{ filename: "a.pdf", chunkIndex: 0, text: "ctx" }]);
});
```

If the existing test file imports `queryRag` at top-level, reuse that import instead of re-importing.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run src/rag/n8n-client.test.ts`
Expected: FAIL (`body.libraryDocs` is `undefined`).

- [ ] **Step 3: Update `n8n-client.ts`**

Change the `queryRag` signature and body:

```ts
export async function queryRag(
  conversationId: string,
  question: string,
  history: ChatTurn[] = [],
  generateTitle = false,
  libraryDocs: QuerySource[] = [],
): Promise<QueryResult> {
  const res = await fetch(url(QUERY_PATH), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, question, history, generateTitle, libraryDocs }),
  });
  if (!res.ok) {
    throw new Error(`n8n query failed: ${res.status}`);
  }
  const data = (await res.json()) as Partial<QueryResult>;
  return {
    answer: data.answer ?? "",
    sources: Array.isArray(data.sources) ? data.sources : [],
    title: typeof data.title === "string" ? data.title : undefined,
  };
}
```

`QuerySource` is already defined in this file — no new import needed.

- [ ] **Step 4: Update `provider.ts`**

```ts
export async function queryRag(
  conversationId: string,
  question: string,
  history: ChatTurn[] = [],
  generateTitle = false,
  libraryDocs: QuerySource[] = [],
): Promise<QueryResult> {
  if (config.RAG_PROVIDER === "langgraph") {
    // langgraph path does not consume libraryDocs; the backend-driven library
    // enriches the n8n path only.
    return (await langgraph()).queryRag(conversationId, question, history, generateTitle);
  }
  return n8n.queryRag(conversationId, question, history, generateTitle, libraryDocs);
}
```

Add `QuerySource` to the existing type import at the top of `provider.ts`:
`import type { ChatTurn, QueryResult, IngestResult, QuerySource } from "./types.js";`

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/rag/n8n-client.test.ts src/rag/provider.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/rag/n8n-client.ts src/rag/provider.ts src/rag/n8n-client.test.ts
git commit -m "Thread libraryDocs through the n8n query client and provider

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Library upload / list / delete routes

**Files:**
- Modify: `backend/src/library/routes.ts`
- Modify: `backend/src/library/routes.test.ts`

**Interfaces:**
- Consumes: `indexUpload` (T7), `listIndexed`/`deleteDocument`/`summary` (T2), `deleteBySource` (T5), `isAllowedUpload` (existing), `requireCsrf` (existing).
- Produces routes (all admin-only): `POST /library/documents`, `GET /library/documents`, `DELETE /library/documents/:id`, `GET /library/status`.

- [ ] **Step 1: Write the failing test**

Replace `backend/src/library/routes.test.ts` with (keep the existing guard-mock pattern):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { buildTestApp } from "../test/app-harness.js";

vi.mock("../auth/middleware.js", () => ({
  requireAuth: (_q: unknown, _s: unknown, n: () => void) => n(),
  requireAdmin: (_q: unknown, _s: unknown, n: () => void) => n(),
}));
vi.mock("../auth/csrf.js", () => ({ requireCsrf: (_q: unknown, _s: unknown, n: () => void) => n() }));

const indexUpload = vi.fn(async () => ({ id: "doc-1", status: "indexed", chunkCount: 3 }));
vi.mock("./ingest.js", () => ({ indexUpload }));

const listIndexed = vi.fn(async () => [{ id: "doc-1", filename: "a.pdf" }]);
const deleteDocument = vi.fn(async () => {});
const summary = vi.fn(async () => ({ total: 1, failed: 0, lastIndexedAt: null }));
vi.mock("./repo.js", () => ({ listIndexed, deleteDocument, summary }));

const deleteBySource = vi.fn(async () => {});
vi.mock("./vector-store.js", () => ({ deleteBySource }));

const { libraryRouter } = await import("./routes.js");
const app = () => buildTestApp((a) => a.use("/library", libraryRouter));

describe("library routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uploads a document and returns its id", async () => {
    const res = await request(app())
      .post("/library/documents")
      .attach("file", Buffer.from("hello"), { filename: "a.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ id: "doc-1", status: "indexed", chunkCount: 3 });
    expect(indexUpload).toHaveBeenCalled();
  });

  it("rejects an unsupported file type", async () => {
    const res = await request(app())
      .post("/library/documents")
      .attach("file", Buffer.from("x"), { filename: "a.exe", contentType: "application/x-msdownload" });
    expect(res.status).toBe(400);
    expect(indexUpload).not.toHaveBeenCalled();
  });

  it("lists documents", async () => {
    const res = await request(app()).get("/library/documents");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("deletes a document from Qdrant and Postgres", async () => {
    const res = await request(app()).delete("/library/documents/doc-1");
    expect(res.status).toBe(204);
    expect(deleteBySource).toHaveBeenCalledWith("doc-1");
    expect(deleteDocument).toHaveBeenCalledWith("doc-1");
  });
});
```

(`supertest` is already a dev dependency used by other route tests — confirm with `grep supertest package.json`; if absent, `npm i -D supertest @types/supertest`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run src/library/routes.test.ts`
Expected: FAIL (routes not implemented).

- [ ] **Step 3: Implement `routes.ts`**

```ts
import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { requireAuth, requireAdmin } from "../auth/middleware.js";
import { requireCsrf } from "../auth/csrf.js";
import { isAllowedUpload } from "../rag/upload-allowlist.js";
import { indexUpload } from "./ingest.js";
import { listIndexed, deleteDocument, summary } from "./repo.js";
import { deleteBySource } from "./vector-store.js";

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

function uploadSingle(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "File too large (max 50 MB)" });
      return;
    }
    if (err) {
      next(err as Error);
      return;
    }
    next();
  });
}

// Upload a document into the shared library and index it into Qdrant.
router.post("/documents", requireCsrf, uploadSingle, async (req: Request, res: Response) => {
  const file = req.file;
  if (!file || !isAllowedUpload(file.mimetype, file.originalname)) {
    res.status(400).json({ error: "Unsupported file type" });
    return;
  }
  const result = await indexUpload(file.originalname, file.mimetype, file.buffer);
  res.status(202).json(result);
});

// List indexed library documents (admin UI).
router.get("/documents", async (_req: Request, res: Response) => {
  res.json(await listIndexed());
});

// Remove a document's vectors and its index row.
router.delete("/documents/:id", requireCsrf, async (req: Request<{ id: string }>, res: Response) => {
  await deleteBySource(req.params.id);
  await deleteDocument(req.params.id);
  res.status(204).end();
});

// Report library index state (counts + last index time).
router.get("/status", async (_req: Request, res: Response) => {
  res.json(await summary());
});

export { router as libraryRouter };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/library/routes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/library/routes.ts src/library/routes.test.ts
git commit -m "Add admin library routes: upload, list, delete, status

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Wire gated library retrieval into the chat ask path

**Files:**
- Modify: `backend/src/rag/chat-routes.ts` (ask handler around lines 270-321)
- Modify: `backend/src/rag/chat-routes.test.ts`

**Interfaces:**
- Consumes: `searchLibrary`/`shouldSearchLibrary` (T8), `queryRag` (T9, now accepts `libraryDocs`).
- Produces: ask handler passes gated `libraryDocs` to `queryRag`; library failures degrade to no library results.

- [ ] **Step 1: Write the failing test**

Add to `backend/src/rag/chat-routes.test.ts` (follow the file's existing mock setup; it already mocks `./provider.js`). Ensure the test file mocks the library retrieve module:

```ts
// near the other vi.mock calls at the top of the file:
const searchLibrary = vi.fn(async () => [{ filename: "lib.pdf", chunkIndex: 0, text: "libctx" }]);
const shouldSearchLibrary = vi.fn(async () => true);
vi.mock("../library/retrieve.js", () => ({ searchLibrary, shouldSearchLibrary }));
```

```ts
it("passes gated library docs to queryRag on a document-ish question", async () => {
  // queryRagMock is the existing mock for provider.queryRag in this file.
  queryRagMock.mockResolvedValue({ answer: "a", sources: [] });
  await request(app())
    .post(`/chat/conversations/${CONV_ID}/messages`)
    .send({ question: "what does the SOP say?" });
  const call = queryRagMock.mock.calls.at(-1);
  expect(call?.[4]).toEqual([{ filename: "lib.pdf", chunkIndex: 0, text: "libctx" }]);
});

it("skips the library when useLibrary is false", async () => {
  queryRagMock.mockResolvedValue({ answer: "a", sources: [] });
  await request(app())
    .post(`/chat/conversations/${CONV_ID}/messages`)
    .send({ question: "hi", useLibrary: false });
  expect(shouldSearchLibrary).not.toHaveBeenCalled();
  const call = queryRagMock.mock.calls.at(-1);
  expect(call?.[4]).toEqual([]);
});
```

Adapt `app()`, `CONV_ID`, and `queryRagMock` to the names already used in the test file (check how the existing message-post tests are structured and reuse their setup, including any DB mock needed for `ownedConversation` and the message inserts).

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run src/rag/chat-routes.test.ts`
Expected: FAIL (`call[4]` is `undefined`; retrieval not wired).

- [ ] **Step 3: Restore `useLibrary` and add the imports**

At the top of `chat-routes.ts`, add:

```ts
import { searchLibrary, shouldSearchLibrary } from "../library/retrieve.js";
import type { QuerySource } from "./types.js";
```

Restore the destructure (reverted in Task 1):

```ts
const { question, useLibrary } = parsed.data;
```

- [ ] **Step 4: Compute and pass `libraryDocs`**

Replace the ask-path query block:

```ts
    let result: QueryResult;
    try {
      result = await queryRag(req.params.id, question, history, isFirstMessage);
    } catch {
      res.status(502).json({ error: "The assistant is unavailable right now" });
      return;
    }
```

with:

```ts
    // Gate: an explicit useLibrary flag wins; otherwise a cheap intent check
    // decides. Library retrieval must never break a normal answer, so any
    // failure degrades to no library results.
    let libraryDocs: QuerySource[] = [];
    try {
      const doSearch = useLibrary ?? (await shouldSearchLibrary(question));
      if (doSearch) libraryDocs = await searchLibrary(question);
    } catch {
      libraryDocs = [];
    }

    let result: QueryResult;
    try {
      result = await queryRag(req.params.id, question, history, isFirstMessage, libraryDocs);
    } catch {
      res.status(502).json({ error: "The assistant is unavailable right now" });
      return;
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/rag/chat-routes.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full suite**

Run: `cd backend && npx vitest run`
Expected: PASS (all suites green).

- [ ] **Step 7: Commit**

```bash
git add src/rag/chat-routes.ts src/rag/chat-routes.test.ts
git commit -m "Wire gated library retrieval into the chat ask path

Explicit useLibrary flag or a cheap intent gate decides whether to search
the vector library; hits are passed to queryRag as libraryDocs. Library
failures degrade to a normal answer.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Additive n8n `RAG Query` edit — accept and label `libraryDocs`

Makes the live `RAG Query` workflow read the new `libraryDocs` field and merge it into context labeled `Library`. This is the only n8n change. **Back up the workflow first.**

**Files:**
- Create: `n8n/backups/RAG-Query-<before>.json` (exported workflow JSON, pre-edit)
- (Live) n8n workflow `RAG Query` (id `H4WL7om1JO3UmavC`)

**Interfaces:**
- Consumes: `libraryDocs: {filename, chunkIndex, text}[]` in the `rag-query` request body (Task 9).
- Produces: those chunks appear in the answer context with `origin: 'Library'`.

- [ ] **Step 1: Back up the current workflow**

Use the n8n MCP `get_workflow_details` for id `H4WL7om1JO3UmavC` and save the returned JSON to `n8n/backups/RAG-Query-2026-07-03.json` in the repo. Commit it:

```bash
git add n8n/backups/RAG-Query-2026-07-03.json
git commit -m "Back up RAG Query workflow before libraryDocs edit

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 2: Pass `libraryDocs` through `Normalize Input`**

Edit the `Normalize Input` node's `jsonOutput` expression to include `libraryDocs`. The new expression:

```
={{ JSON.stringify({ conversationId: ($json.body && $json.body.conversationId) || $json.conversationId || "", question: ($json.body && $json.body.question) || $json.question || "", history: ($json.body && $json.body.history) || $json.history || [], docs: ($json.body && $json.body.docs) || $json.docs || [], libraryDocs: ($json.body && $json.body.libraryDocs) || $json.libraryDocs || [] }) }}
```

- [ ] **Step 3: Add a `Library Docs To Rows` code node**

Create a new Code node named `Library Docs To Rows` with this JS:

```js
const lib = $('Normalize Input').first().json.libraryDocs || [];
return lib.map((d, i) => ({
  json: {
    driveFileId: 'library:' + i,
    filename: d.filename || '',
    text: d.text || '',
    isLibrary: true,
    origin: 'Library',
  },
}));
```

Wire it: `Prepare Retrieval` → `Library Docs To Rows` → `Merge Loads` (input index 0, the same input `Docs To Rows` feeds). Multiple nodes into merge input 0 concatenate their items.

- [ ] **Step 4: Label library rows as `Library` in `Build Context and Sources`**

In the `Build Context and Sources` code node, the row-building loop currently sets `const origin = r.isLibrary ? 'Drive' : 'This chat';`. Change it to honor an explicit origin:

```js
const origin = r.origin || (r.isLibrary ? 'Drive' : 'This chat');
```

And where library rows are pushed (the `else if (j.driveFileId && j.text != null)` branch), carry the origin through:

```js
} else if (j.driveFileId && j.text != null) {
  rows.push({ text: String(j.text).slice(0, 24000), filename: j.filename || '', isLibrary: true, origin: j.origin });
}
```

- [ ] **Step 5: Validate the workflow**

Use the n8n MCP `validate_workflow` on the updated code. Expected: valid (no errors). Fix and re-validate if needed.

- [ ] **Step 6: Manual smoke test**

With the backend running against this n8n, send a chat message that hits the library (e.g. after uploading one doc via `POST /library/documents`, ask a synonym question). Confirm the answer cites the uploaded doc and the source `origin` shows `Library`. If the live per-chat `docs` path is unaffected (ask a normal question), the change is safe.

- [ ] **Step 7: Publish + export the post-edit backup**

Publish the workflow via the n8n MCP. Then export the updated JSON and save it to `n8n/backups/RAG-Query-2026-07-03-after.json`:

```bash
git add n8n/backups/RAG-Query-2026-07-03-after.json
git commit -m "Edit RAG Query to accept and label libraryDocs context

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Deployment notes (post-implementation)

- Ensure a Qdrant service runs in the integrated VPS stack (`/opt/rag-skripsi-stack`), reachable from the backend as `QDRANT_URL`.
- Set backend env: `QDRANT_URL`, `OPENAI_API_KEY` (a direct OpenAI key with embedding access — not the capped OpenRouter key), and confirm `QDRANT_COLLECTION_LIBRARY` / `EMBED_MODEL` defaults.
- Run `npx tsx src/db/migrate.ts` in the deploy environment to apply the `library_documents` migration.
- Per the branch workflow: implement on `dev2`, then port the changes additively onto `vps-backend` for deploy (never merge the two branches).

## Self-review

- **Spec coverage:** Store (T5), backend-drives-Qdrant (T4/T5/T7/T8), embeddings model (T4), text extraction via RAG Read (T6), shared/admin scope (T10), intent-gated + explicit override trigger (T8/T11), inject into rag-query (T9/T11/T12), generalized data model (T2), config reuse (Global Constraints), error handling (T7/T11), testing (each task), no-src-langchain (T1 + all new files), Drive as P2 (out of scope, noted). Covered.
- **Placeholder scan:** none — every code step contains full code and exact commands.
- **Type consistency:** `QuerySource {filename, chunkIndex, text}` used consistently (T5→T8→T9→T11); `indexUpload` return shape matches T7↔T10; `insertDocument`/`updateDocument`/`deleteDocument`/`listIndexed`/`summary` signatures match T2↔T7↔T10; `search`/`upsertChunks`/`deleteBySource` signatures match T5↔T7↔T8↔T10.
