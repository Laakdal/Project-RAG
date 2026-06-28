# Phase 2a — Drive Library Sync Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the manual, incremental "Sync library" pipeline that reads a Google Drive folder, OCRs/reads every new or changed document with Gemini, embeds it, and stores it in a persistent Qdrant `project_rag_library` collection — with a Postgres `library_documents` table tracking sync state.

**Architecture:** Heavy compute (Drive client, document reading, embedding, Qdrant) lives in `backend/src-langchain/` and is DB-agnostic, mirroring Phase 1. The DB-aware orchestration (diff against `library_documents`, persist results) lives in `backend/src/library/`. A `POST /library/sync` admin endpoint runs the sync; `GET /library/status` reports state. Per-chat and the Phase 1 path are untouched.

**Tech Stack:** TypeScript (ESM, NodeNext), Express 5, Drizzle/Postgres, Qdrant (`@langchain/qdrant` + `@qdrant/js-client-rest`), `googleapis`, `@langchain/openai`, `@langchain/textsplitters`, Gemini (OpenRouter), Gotenberg. Tests: vitest + supertest.

## Global Constraints

- **Language/module:** TypeScript ESM; every relative import uses a `.js` suffix (NodeNext).
- **Reuse Phase 1:** `geminiRead`, `makeEmbeddings`, `RecursiveCharacterTextSplitter`, the Qdrant client, and `readDocument` already exist in `backend/src-langchain/`. Extend, don't duplicate.
- **New Qdrant collection:** `project_rag_library` (1536-D, cosine, OpenAI `text-embedding-3-small`). Never reuse `project_rag_chat_lg` or `project_rag_chat_oai`.
- **Chunk/point metadata (exact):** `{ driveFileId, filename, webUrl, chunkIndex, modifiedTime }`.
- **Two stores stay separate:** nothing here touches per-chat tables/collections; the library index is written ONLY by the sync path.
- **DB boundary:** `src-langchain/` code never imports `db`; all Postgres access lives in `src/`.
- **Admin-gated sync:** `POST /library/sync` is behind `requireAuth` + `requireAdmin` + `requireCsrf` (mirror `backend/src/admin/routes.ts:13-14`). `requireAdmin` is exported from `backend/src/auth/middleware.js`.
- **Per-file isolation:** one unreadable Drive file never aborts the sync; it's recorded `failed` and the run continues.
- **Incremental:** a file is (re)read only when new or its Drive `modifiedTime` differs from the indexed row; deleted-from-Drive files have their vectors + row removed.
- **Library churn / version-sensitive APIs:** for every `googleapis` and Qdrant-client call, confirm the exact method signature against current docs (context7 MCP: `resolve-library-id` → `query-docs`) before finalizing — the code below reflects v3 Drive + Qdrant REST patterns but pin at implementation.
- **Tests:** co-located `*.test.ts`, vitest, `vi.stubGlobal("fetch", vi.fn())` for HTTP, `vi.mock` for modules, the `src/test/app-harness.js` (`buildTestApp`/`makeDbMock`) + supertest for routes. All tests MOCKED — no live Drive/Qdrant/OpenAI/Gotenberg. Run from `backend/` with `npm test`.
- **Commits:** plain messages, no conventional-commit prefixes.

---

## File Structure

**New files:**
- `backend/src-langchain/library/drive.ts` — Google Drive client (list folder, download/export). DB-agnostic.
- `backend/src-langchain/library/drive.test.ts`
- `backend/src/library/diff.ts` — pure classification of a Drive listing vs indexed rows.
- `backend/src/library/diff.test.ts`
- `backend/src/library/repo.ts` — Postgres ops for `library_documents`.
- `backend/src/library/repo.test.ts`
- `backend/src/library/sync.ts` — DB-aware sync orchestrator.
- `backend/src/library/sync.test.ts`
- `backend/src/library/routes.ts` — `/library` router (`POST /sync`, `GET /status`).
- `backend/src/library/routes.test.ts`

**Modified files:**
- `backend/src/config.ts` — add `DRIVE_FOLDER_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `QDRANT_COLLECTION_LIBRARY`.
- `backend/src/config.test.ts` — assert the new collection default.
- `backend/src/db/schema.ts` — add `libraryDocuments` table.
- `backend/src-langchain/shared/qdrant.ts` — add `getLibraryVectorStore()`, `upsertLibraryDocuments()`, `deleteLibraryFile()`.
- `backend/src-langchain/shared/qdrant.test.ts` — cover the library helpers.
- `backend/src-langchain/ingest/read.ts` — extend to route all Office formats (DOCX/XLSX/PPTX) through Gotenberg.
- `backend/src-langchain/ingest/read.test.ts` — add XLSX/PPTX cases.
- `backend/src/server.ts` — mount `app.use("/library", libraryRouter)`.
- `backend/package.json` — add `googleapis` (+ `@qdrant/js-client-rest` if not already transitive).
- `backend/drizzle/*` — generated migration for `library_documents`.

**Frontend (separate, last task):**
- A "Sync library" admin button + status display calling the two endpoints.

---

## Task 1: Library config keys + googleapis dependency

**Files:**
- Modify: `backend/src/config.ts` (envSchema)
- Modify: `backend/src/config.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Produces: `config.QDRANT_COLLECTION_LIBRARY` (default `"project_rag_library"`), optional `config.DRIVE_FOLDER_ID`, `config.GOOGLE_SERVICE_ACCOUNT_JSON`.

- [ ] **Step 1: Write the failing test** — append to `backend/src/config.test.ts`:

```ts
it("defaults QDRANT_COLLECTION_LIBRARY to project_rag_library", () => {
  expect(config.QDRANT_COLLECTION_LIBRARY).toBe("project_rag_library");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run src/config.test.ts`
Expected: FAIL — `config.QDRANT_COLLECTION_LIBRARY` is `undefined`.

- [ ] **Step 3: Add keys to `envSchema`** in `backend/src/config.ts`, after the existing langgraph keys (before the closing `});`):

```ts
  // Phase 2 — Drive library. Optional because the library is disabled until
  // configured; the sync path validates presence at use and errors clearly.
  DRIVE_FOLDER_ID: z.string().min(1).optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().min(1).optional(),
  QDRANT_COLLECTION_LIBRARY: z.string().min(1).default("project_rag_library"),
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd backend && npx vitest run src/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Install googleapis**

Run: `cd backend && npm install googleapis`
(Confirm the current package name/version via context7 first. If `@qdrant/js-client-rest` is needed directly by Task 3 and isn't already present, `npm install @qdrant/js-client-rest` too.) If install fails (no network), report BLOCKED.

- [ ] **Step 6: Verify suite + typecheck still green**

Run: `cd backend && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/config.ts backend/src/config.test.ts backend/package.json backend/package-lock.json
git commit -m "add drive library config keys and googleapis dependency"
```

---

## Task 2: `library_documents` table + migration

**Files:**
- Modify: `backend/src/db/schema.ts`
- Create: `backend/drizzle/<generated>.sql` (via drizzle-kit)

**Interfaces:**
- Produces: `libraryDocuments` table + `LibraryDocument` / `NewLibraryDocument` types. Columns: `driveFileId` (text PK), `filename`, `mimeType`, `modifiedTime` (text, the Drive RFC3339 string), `chunkCount` (int), `status` (text: `indexed | failed`), `webUrl` (text), `lastError` (text, nullable), `indexedAt` (timestamptz, default now).

- [ ] **Step 1: Add the table** to `backend/src/db/schema.ts` (after `attachments`):

```ts
export const libraryDocuments = pgTable("library_documents", {
  // The Google Drive file id is the natural key — stable across edits.
  driveFileId: text("drive_file_id").primaryKey(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  // Drive's RFC3339 modifiedTime, stored verbatim so "changed" is a string compare.
  modifiedTime: text("modified_time").notNull(),
  chunkCount: integer("chunk_count").notNull().default(0),
  status: text("status").notNull(), // "indexed" | "failed"
  webUrl: text("web_url"),
  lastError: text("last_error"),
  indexedAt: timestamp("indexed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type LibraryDocument = typeof libraryDocuments.$inferSelect;
export type NewLibraryDocument = typeof libraryDocuments.$inferInsert;
```

- [ ] **Step 2: Generate the migration**

Run: `cd backend && npm run db:generate`
Expected: a new `backend/drizzle/NNNN_*.sql` creating `library_documents` (+ updated `_journal.json`/snapshot). Inspect the `.sql` — it must `CREATE TABLE "library_documents"` and touch nothing else.

- [ ] **Step 3: Typecheck**

Run: `cd backend && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/schema.ts backend/drizzle
git commit -m "add library_documents table and migration"
```

---

## Task 3: Qdrant library helpers

**Files:**
- Modify: `backend/src-langchain/shared/qdrant.ts`
- Modify: `backend/src-langchain/shared/qdrant.test.ts`

**Interfaces:**
- Consumes: `makeEmbeddings` (existing), `config.QDRANT_URL`, `config.QDRANT_COLLECTION_LIBRARY`.
- Produces:
  - `getLibraryVectorStore(): Promise<QdrantVectorStore>` — bound to `project_rag_library`.
  - `upsertLibraryDocuments(docs: Document[]): Promise<void>` — adds chunks (each `Document` carries metadata `{driveFileId, filename, webUrl, chunkIndex, modifiedTime}`).
  - `deleteLibraryFile(driveFileId: string): Promise<void>` — removes all points whose `metadata.driveFileId` matches.

- [ ] **Step 1: Write the failing tests** — append to `backend/src-langchain/shared/qdrant.test.ts` (the file already mocks `@langchain/qdrant`; extend the mock to expose a `client`):

```ts
it("getLibraryVectorStore binds the library collection", async () => {
  const { getLibraryVectorStore } = await import("./qdrant.js");
  await getLibraryVectorStore();
  const calls = (fromExisting as ReturnType<typeof vi.fn>).mock.calls;
  const [, opts] = calls[calls.length - 1];
  expect(opts.collectionName).toBe("project_rag_library");
});
```

(For `deleteLibraryFile`, assert it calls the underlying Qdrant client's delete with a `metadata.driveFileId` filter — adapt the mock to return a store whose `.client.delete` is a `vi.fn()`.)

- [ ] **Step 2: Run and watch it fail**

Run: `cd backend && npx vitest run src-langchain/shared/qdrant.test.ts`
Expected: FAIL — `getLibraryVectorStore` not exported.

- [ ] **Step 3: Implement the helpers** in `backend/src-langchain/shared/qdrant.ts` (confirm the `QdrantVectorStore.client` accessor and the REST `delete` filter shape via context7):

```ts
import { QdrantVectorStore } from "@langchain/qdrant";
import type { Document } from "@langchain/core/documents";
import { config } from "../../src/config.js";
import { makeEmbeddings } from "./models.js";

export async function getVectorStore(): Promise<QdrantVectorStore> {
  return QdrantVectorStore.fromExistingCollection(makeEmbeddings(), {
    url: config.QDRANT_URL,
    collectionName: config.QDRANT_COLLECTION_LG,
  });
}

export async function getLibraryVectorStore(): Promise<QdrantVectorStore> {
  return QdrantVectorStore.fromExistingCollection(makeEmbeddings(), {
    url: config.QDRANT_URL,
    collectionName: config.QDRANT_COLLECTION_LIBRARY,
  });
}

export async function upsertLibraryDocuments(docs: Document[]): Promise<void> {
  if (docs.length === 0) return;
  const store = await getLibraryVectorStore();
  await store.addDocuments(docs);
}

export async function deleteLibraryFile(driveFileId: string): Promise<void> {
  const store = await getLibraryVectorStore();
  // The LangChain store wraps a @qdrant/js-client-rest client at `.client`.
  await store.client.delete(config.QDRANT_COLLECTION_LIBRARY, {
    filter: { must: [{ key: "metadata.driveFileId", match: { value: driveFileId } }] },
  });
}
```

- [ ] **Step 4: Run and watch them pass**

Run: `cd backend && npx vitest run src-langchain/shared/qdrant.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src-langchain/shared/qdrant.ts backend/src-langchain/shared/qdrant.test.ts
git commit -m "add qdrant library collection helpers"
```

---

## Task 4: Extend the reader for all Office formats

**Files:**
- Modify: `backend/src-langchain/ingest/read.ts`
- Modify: `backend/src-langchain/ingest/read.test.ts`

**Interfaces:**
- Produces: `readDocument(file, mimeType)` now routes **DOCX, XLSX, PPTX** through Gotenberg→PDF→Gemini; PDF/images/text go straight to `geminiRead`. Same signature.

- [ ] **Step 1: Write the failing test** — add to `backend/src-langchain/ingest/read.test.ts` an XLSX case asserting Gotenberg is hit and Gemini receives `application/pdf`:

```ts
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

it("converts XLSX via Gotenberg before reading", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  })));
  const { readDocument } = await import("./read.js");
  const text = await readDocument(Buffer.from("PK"), XLSX);
  expect(text).toBe("doc text");
  expect(fetch).toHaveBeenCalled();
  expect(geminiRead.mock.calls[0][1]).toBe("application/pdf");
  vi.unstubAllGlobals();
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd backend && npx vitest run src-langchain/ingest/read.test.ts`
Expected: FAIL — XLSX currently falls through to `geminiRead(file, XLSX)`, so no Gotenberg fetch.

- [ ] **Step 3: Generalize `read.ts`** — replace the DOCX-only branch with an Office-format set:

```ts
import { geminiRead } from "../shared/models.js";
import { config } from "../../src/config.js";

const OFFICE_MIME = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",       // xlsx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // pptx
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
]);

async function officeToPdf(file: Buffer, mimeType: string, filename = "in"): Promise<Buffer> {
  if (!config.GOTENBERG_URL) throw new Error("GOTENBERG_URL required for Office files");
  const form = new FormData();
  form.append("files", new Blob([file], { type: mimeType }), filename);
  const res = await fetch(
    `${config.GOTENBERG_URL.replace(/\/$/, "")}/forms/libreoffice/convert`,
    { method: "POST", body: form },
  );
  if (!res.ok) throw new Error(`gotenberg convert failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function readDocument(file: Buffer, mimeType: string): Promise<string> {
  if (OFFICE_MIME.has(mimeType)) {
    const pdf = await officeToPdf(file, mimeType);
    return geminiRead(pdf, "application/pdf");
  }
  return geminiRead(file, mimeType);
}
```

- [ ] **Step 4: Run and watch all read tests pass** (the existing DOCX + PDF cases must still pass)

Run: `cd backend && npx vitest run src-langchain/ingest/read.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src-langchain/ingest/read.ts backend/src-langchain/ingest/read.test.ts
git commit -m "route all office formats through gotenberg in the reader"
```

---

## Task 5: Google Drive client

**Files:**
- Create: `backend/src-langchain/library/drive.ts`
- Test: `backend/src-langchain/library/drive.test.ts`

**Interfaces:**
- Consumes: `googleapis`, `config.GOOGLE_SERVICE_ACCOUNT_JSON`, `config.DRIVE_FOLDER_ID`.
- Produces:
  - `type DriveFile = { id: string; name: string; mimeType: string; modifiedTime: string; webUrl: string }`
  - `listFolder(folderId: string): Promise<DriveFile[]>` — paginated, non-trashed.
  - `downloadFile(file: DriveFile): Promise<{ buffer: Buffer; mimeType: string }>` — Google-native (`application/vnd.google-apps.*`) → export to PDF; else raw media. Returns the **effective** mimeType (`application/pdf` for exports).

- [ ] **Step 1: Write the failing test** `drive.test.ts` (mock `googleapis`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const list = vi.fn();
const get = vi.fn();
const exportFn = vi.fn();
vi.mock("googleapis", () => ({
  google: {
    auth: { GoogleAuth: class { getClient() { return {}; } } },
    drive: () => ({ files: { list, get, export: exportFn } }),
  },
}));

describe("drive client", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists a folder across pages", async () => {
    list
      .mockResolvedValueOnce({ data: { files: [{ id: "a", name: "a.pdf", mimeType: "application/pdf", modifiedTime: "t1", webViewLink: "u" }], nextPageToken: "p2" } })
      .mockResolvedValueOnce({ data: { files: [{ id: "b", name: "b.pdf", mimeType: "application/pdf", modifiedTime: "t2", webViewLink: "u" }] } });
    const { listFolder } = await import("./drive.js");
    const files = await listFolder("folder1");
    expect(files.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("exports google-native files to pdf, downloads others as media", async () => {
    exportFn.mockResolvedValue({ data: new ArrayBuffer(3) });
    get.mockResolvedValue({ data: new ArrayBuffer(3) });
    const { downloadFile } = await import("./drive.js");
    const gdoc = await downloadFile({ id: "g", name: "n", mimeType: "application/vnd.google-apps.document", modifiedTime: "t", webUrl: "u" });
    expect(gdoc.mimeType).toBe("application/pdf");
    expect(exportFn).toHaveBeenCalled();
    const pdf = await downloadFile({ id: "p", name: "n", mimeType: "application/pdf", modifiedTime: "t", webUrl: "u" });
    expect(pdf.mimeType).toBe("application/pdf");
    expect(get).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd backend && npx vitest run src-langchain/library/drive.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `drive.ts`** (confirm `googleapis` v3 auth + `files.list/get/export` options via context7; the `GoogleAuth` credentials shape and `responseType:"arraybuffer"` in particular):

```ts
import { google } from "googleapis";
import { config } from "../../src/config.js";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webUrl: string;
};

function driveClient() {
  if (!config.GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON required");
  const credentials = JSON.parse(config.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  return google.drive({ version: "v3", auth });
}

export async function listFolder(folderId: string): Promise<DriveFile[]> {
  const drive = driveClient();
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink)",
      pageSize: 100,
      pageToken,
    });
    for (const f of res.data.files ?? []) {
      out.push({
        id: f.id!,
        name: f.name!,
        mimeType: f.mimeType!,
        modifiedTime: f.modifiedTime!,
        webUrl: f.webViewLink ?? "",
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

export async function downloadFile(file: DriveFile): Promise<{ buffer: Buffer; mimeType: string }> {
  const drive = driveClient();
  if (file.mimeType.startsWith("application/vnd.google-apps")) {
    const res = await drive.files.export(
      { fileId: file.id, mimeType: "application/pdf" },
      { responseType: "arraybuffer" },
    );
    return { buffer: Buffer.from(res.data as ArrayBuffer), mimeType: "application/pdf" };
  }
  const res = await drive.files.get(
    { fileId: file.id, alt: "media" },
    { responseType: "arraybuffer" },
  );
  return { buffer: Buffer.from(res.data as ArrayBuffer), mimeType: file.mimeType };
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `cd backend && npx vitest run src-langchain/library/drive.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src-langchain/library/drive.ts backend/src-langchain/library/drive.test.ts
git commit -m "add google drive client for the library"
```

---

## Task 6: Sync diff (pure classification)

**Files:**
- Create: `backend/src/library/diff.ts`
- Test: `backend/src/library/diff.test.ts`

**Interfaces:**
- Consumes: `DriveFile` (Task 5); `LibraryDocument` (Task 2).
- Produces: `classifyFiles(driveFiles: DriveFile[], indexed: { driveFileId: string; modifiedTime: string }[]): { toIndex: DriveFile[]; toRemove: string[] }` — `toIndex` = files new OR whose `modifiedTime` differs; `toRemove` = indexed `driveFileId`s absent from the Drive listing.

- [ ] **Step 1: Write the failing test** `diff.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyFiles } from "./diff.js";

const f = (id: string, modifiedTime: string) => ({ id, name: id, mimeType: "application/pdf", modifiedTime, webUrl: "u" });

describe("classifyFiles", () => {
  it("indexes new and changed, skips unchanged, removes deleted", () => {
    const drive = [f("a", "t1"), f("b", "t2new"), f("c", "t3")];
    const indexed = [
      { driveFileId: "b", modifiedTime: "t2old" }, // changed
      { driveFileId: "c", modifiedTime: "t3" },    // unchanged
      { driveFileId: "d", modifiedTime: "t4" },    // deleted from drive
    ];
    const { toIndex, toRemove } = classifyFiles(drive, indexed);
    expect(toIndex.map((x) => x.id).sort()).toEqual(["a", "b"]); // a new, b changed
    expect(toRemove).toEqual(["d"]);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd backend && npx vitest run src/library/diff.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `diff.ts`:**

```ts
import type { DriveFile } from "../../src-langchain/library/drive.js";

export function classifyFiles(
  driveFiles: DriveFile[],
  indexed: { driveFileId: string; modifiedTime: string }[],
): { toIndex: DriveFile[]; toRemove: string[] } {
  const byId = new Map(indexed.map((r) => [r.driveFileId, r.modifiedTime]));
  const driveIds = new Set(driveFiles.map((f) => f.id));
  const toIndex = driveFiles.filter((f) => {
    const prev = byId.get(f.id);
    return prev === undefined || prev !== f.modifiedTime;
  });
  const toRemove = indexed
    .filter((r) => !driveIds.has(r.driveFileId))
    .map((r) => r.driveFileId);
  return { toIndex, toRemove };
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `cd backend && npx vitest run src/library/diff.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/library/diff.ts backend/src/library/diff.test.ts
git commit -m "add library sync diff classification"
```

---

## Task 7: `library_documents` repository

**Files:**
- Create: `backend/src/library/repo.ts`
- Test: `backend/src/library/repo.test.ts`

**Interfaces:**
- Consumes: `db` (`../db/index.js`), `libraryDocuments` (Task 2).
- Produces:
  - `listIndexed(): Promise<LibraryDocument[]>`
  - `upsertDocument(row: NewLibraryDocument): Promise<void>` — insert or update by `driveFileId` (Drizzle `onConflictDoUpdate`).
  - `deleteDocument(driveFileId: string): Promise<void>`
  - `summary(): Promise<{ total: number; failed: number; lastIndexedAt: string | null }>`

- [ ] **Step 1: Write the failing test** `repo.test.ts` (mock the db like the existing route tests do via `makeDbMock`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeDbMock } from "../test/app-harness.js";

const dbMock = makeDbMock();
vi.mock("../db/index.js", () => ({ db: dbMock.db }));
const { listIndexed, deleteDocument } = await import("./repo.js");

beforeEach(() => vi.clearAllMocks());

it("listIndexed reads library_documents", async () => {
  dbMock.setResult([{ driveFileId: "a", modifiedTime: "t", status: "indexed" }]);
  const rows = await listIndexed();
  expect(rows[0].driveFileId).toBe("a");
});

it("deleteDocument issues a delete", async () => {
  const deleteSpy = dbMock.db.delete as ReturnType<typeof vi.fn>;
  await deleteDocument("a");
  expect(deleteSpy).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd backend && npx vitest run src/library/repo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `repo.ts`:**

```ts
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { libraryDocuments } from "../db/schema.js";
import type { LibraryDocument, NewLibraryDocument } from "../db/schema.js";

export async function listIndexed(): Promise<LibraryDocument[]> {
  return db.select().from(libraryDocuments);
}

export async function upsertDocument(row: NewLibraryDocument): Promise<void> {
  await db
    .insert(libraryDocuments)
    .values(row)
    .onConflictDoUpdate({ target: libraryDocuments.driveFileId, set: row });
}

export async function deleteDocument(driveFileId: string): Promise<void> {
  await db.delete(libraryDocuments).where(eq(libraryDocuments.driveFileId, driveFileId));
}

export async function summary(): Promise<{ total: number; failed: number; lastIndexedAt: string | null }> {
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

- [ ] **Step 4: Run and watch it pass**

Run: `cd backend && npx vitest run src/library/repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/library/repo.ts backend/src/library/repo.test.ts
git commit -m "add library_documents repository"
```

---

## Task 8: Sync orchestrator

**Files:**
- Create: `backend/src/library/sync.ts`
- Test: `backend/src/library/sync.test.ts`

**Interfaces:**
- Consumes: `listFolder`, `downloadFile` (Task 5); `readDocument` (`ingest/read.js`); `makeEmbeddings` is used indirectly via `upsertLibraryDocuments` (Task 3); `RecursiveCharacterTextSplitter`; `classifyFiles` (Task 6); `listIndexed`/`upsertDocument`/`deleteDocument` (Task 7); `upsertLibraryDocuments`/`deleteLibraryFile` (Task 3); `config.DRIVE_FOLDER_ID`.
- Produces: `runSync(): Promise<{ added: number; updated: number; deleted: number; skipped: number; failed: number; failures: { driveFileId: string; error: string }[] }>`.

- [ ] **Step 1: Write the failing test** `sync.test.ts` (mock every collaborator; assert classification drives the calls and per-file failures are isolated):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config.js", () => ({ config: { DRIVE_FOLDER_ID: "f1", QDRANT_COLLECTION_LIBRARY: "project_rag_library" } }));
const listFolder = vi.fn();
const downloadFile = vi.fn(async () => ({ buffer: Buffer.from("x"), mimeType: "application/pdf" }));
vi.mock("../../src-langchain/library/drive.js", () => ({ listFolder, downloadFile }));
vi.mock("../../src-langchain/ingest/read.js", () => ({ readDocument: vi.fn(async () => "alpha beta gamma") }));
const upsertLibraryDocuments = vi.fn();
const deleteLibraryFile = vi.fn();
vi.mock("../../src-langchain/shared/qdrant.js", () => ({ upsertLibraryDocuments, deleteLibraryFile }));
const listIndexed = vi.fn(async () => [{ driveFileId: "old", modifiedTime: "t" }]);
const upsertDocument = vi.fn();
const deleteDocument = vi.fn();
vi.mock("./repo.js", () => ({ listIndexed, upsertDocument, deleteDocument }));

beforeEach(() => vi.clearAllMocks());

it("indexes new files, removes deleted, isolates per-file failures", async () => {
  listFolder.mockResolvedValue([
    { id: "n1", name: "n1.pdf", mimeType: "application/pdf", modifiedTime: "t1", webUrl: "u" },
    { id: "n2", name: "n2.pdf", mimeType: "application/pdf", modifiedTime: "t2", webUrl: "u" },
  ]); // "old" not present -> removed
  downloadFile.mockImplementationOnce(async () => { throw new Error("drive 404"); }); // n1 fails
  const { runSync } = await import("./sync.js");
  const r = await runSync();
  expect(r.added).toBe(1);          // n2 indexed
  expect(r.failed).toBe(1);         // n1 failed but did not abort
  expect(r.deleted).toBe(1);        // "old" removed
  expect(deleteLibraryFile).toHaveBeenCalledWith("old");
  expect(upsertLibraryDocuments).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd backend && npx vitest run src/library/sync.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `sync.ts`:**

```ts
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";
import { config } from "../config.js";
import { listFolder, downloadFile } from "../../src-langchain/library/drive.js";
import { readDocument } from "../../src-langchain/ingest/read.js";
import { upsertLibraryDocuments, deleteLibraryFile } from "../../src-langchain/shared/qdrant.js";
import { classifyFiles } from "./diff.js";
import { listIndexed, upsertDocument, deleteDocument } from "./repo.js";

const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 150 });

export async function runSync() {
  if (!config.DRIVE_FOLDER_ID) throw new Error("DRIVE_FOLDER_ID required");
  const driveFiles = await listFolder(config.DRIVE_FOLDER_ID);
  const indexed = await listIndexed();
  const { toIndex, toRemove } = classifyFiles(driveFiles, indexed);

  const result = { added: 0, updated: 0, deleted: 0, skipped: driveFiles.length - toIndex.length, failed: 0, failures: [] as { driveFileId: string; error: string }[] };
  const seen = new Set(indexed.map((r) => r.driveFileId));

  for (const file of toIndex) {
    try {
      // Re-index = clear old vectors first so changed files don't leave stale chunks.
      if (seen.has(file.id)) await deleteLibraryFile(file.id);
      const { buffer, mimeType } = await downloadFile(file);
      const text = await readDocument(buffer, mimeType);
      const chunks = await splitter.splitText(text);
      if (chunks.length === 0) throw new Error("no text extracted");
      const docs = chunks.map((content, chunkIndex) =>
        new Document({
          pageContent: content,
          metadata: { driveFileId: file.id, filename: file.name, webUrl: file.webUrl, chunkIndex, modifiedTime: file.modifiedTime },
        }),
      );
      await upsertLibraryDocuments(docs);
      await upsertDocument({ driveFileId: file.id, filename: file.name, mimeType: file.mimeType, modifiedTime: file.modifiedTime, chunkCount: chunks.length, status: "indexed", webUrl: file.webUrl, lastError: null });
      if (seen.has(file.id)) result.updated++; else result.added++;
    } catch (err) {
      result.failed++;
      const error = err instanceof Error ? err.message : String(err);
      result.failures.push({ driveFileId: file.id, error });
      await upsertDocument({ driveFileId: file.id, filename: file.name, mimeType: file.mimeType, modifiedTime: file.modifiedTime, chunkCount: 0, status: "failed", webUrl: file.webUrl, lastError: error });
    }
  }

  for (const id of toRemove) {
    await deleteLibraryFile(id);
    await deleteDocument(id);
    result.deleted++;
  }

  return result;
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `cd backend && npx vitest run src/library/sync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/library/sync.ts backend/src/library/sync.test.ts
git commit -m "add the library sync orchestrator"
```

---

## Task 9: Library routes + mount

**Files:**
- Create: `backend/src/library/routes.ts`
- Test: `backend/src/library/routes.test.ts`
- Modify: `backend/src/server.ts`

**Interfaces:**
- Consumes: `requireAuth`, `requireAdmin` (`../auth/middleware.js`), `requireCsrf` (`../auth/csrf.js`), `runSync` (Task 8), `summary` (Task 7).
- Produces: `libraryRouter` mounted at `/library`. `POST /library/sync` (admin+csrf) → `{ added, updated, deleted, skipped, failed, failures }`. `GET /library/status` → `summary()`.

- [ ] **Step 1: Write the failing test** `routes.test.ts` (mirror `admin/routes.test.ts`: mock the middleware + the sync/summary modules + harness):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { buildTestApp } from "../test/app-harness.js";

vi.mock("../auth/middleware.js", () => ({
  requireAuth: (_q: unknown, _s: unknown, n: () => void) => n(),
  requireAdmin: (_q: unknown, _s: unknown, n: () => void) => n(),
}));
vi.mock("../auth/csrf.js", () => ({ requireCsrf: (_q: unknown, _s: unknown, n: () => void) => n(), CSRF_HEADER_NAME: "x-csrf-token" }));
const runSync = vi.fn(async () => ({ added: 2, updated: 0, deleted: 1, skipped: 5, failed: 0, failures: [] }));
vi.mock("./sync.js", () => ({ runSync }));
vi.mock("./repo.js", () => ({ summary: vi.fn(async () => ({ total: 8, failed: 0, lastIndexedAt: "t" })) }));

const { libraryRouter } = await import("./routes.js");
const app = () => buildTestApp((a) => a.use("/library", libraryRouter));

beforeEach(() => vi.clearAllMocks());

it("POST /library/sync runs a sync and returns the summary", async () => {
  const res = await request(app()).post("/library/sync").send({});
  expect(res.status).toBe(200);
  expect(res.body.added).toBe(2);
  expect(runSync).toHaveBeenCalled();
});

it("GET /library/status returns counts", async () => {
  const res = await request(app()).get("/library/status");
  expect(res.status).toBe(200);
  expect(res.body.total).toBe(8);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd backend && npx vitest run src/library/routes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `routes.ts`:**

```ts
import { Router, type Request, type Response } from "express";
import { requireAuth, requireAdmin } from "../auth/middleware.js";
import { requireCsrf } from "../auth/csrf.js";
import { runSync } from "./sync.js";
import { summary } from "./repo.js";

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

router.post("/sync", requireCsrf, async (_req: Request, res: Response) => {
  const result = await runSync();
  res.json(result);
});

router.get("/status", async (_req: Request, res: Response) => {
  res.json(await summary());
});

export { router as libraryRouter };
```

- [ ] **Step 4: Mount it** in `backend/src/server.ts` — add the import next to the others and the mount next to `app.use("/admin", adminRouter)`:

```ts
import { libraryRouter } from "./library/routes.js";
// ...
app.use("/library", libraryRouter);
```

- [ ] **Step 5: Run the test + full suite + typecheck**

Run: `cd backend && npx vitest run src/library/routes.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/library/routes.ts backend/src/library/routes.test.ts backend/src/server.ts
git commit -m "add library sync and status routes"
```

---

## Task 10: Frontend "Sync library" admin control

**Files:**
- Create: a Sync panel under the admin area (follow the existing admin page pattern in `frontend/app/(main)/.../admin` — match how the Users page calls the backend).
- Modify: `frontend/next.config.mjs` — add `/library/*` to the rewrite prefixes so the SPA reaches the backend (mirror the existing `/admin/*` rewrite).

This task has no unit runner; verify via `tsc --noEmit` + lint + manual click-through (matches the admin-panel frontend convention).

- [ ] **Step 1: Add the `/library` rewrite** in `frontend/next.config.mjs` alongside the existing backend prefixes (`/auth`, `/chat`, `/admin`, `/health`).

- [ ] **Step 2: Build a minimal admin "Library" panel** — a "Sync library" button that POSTs `/library/sync` (with the CSRF header, like the other admin mutations) and shows the returned summary, plus a status line from `GET /library/status`. Reuse the existing admin API client pattern.

- [ ] **Step 3: Verify**

Run (from `frontend/`): `npx tsc --noEmit` and the project's lint.
Expected: clean. Then manual: log in as admin → open the Library panel → click Sync → see the summary; reload → status reflects the indexed count.

- [ ] **Step 4: Commit**

```bash
git add frontend/next.config.mjs frontend/app
git commit -m "add the sync library admin control"
```

---

## Self-Review (against the spec)

**Spec coverage:**
- Pre-indexed library, separate from per-chat → new `project_rag_library` collection (Tasks 1, 3) + `library_documents` (Task 2); per-chat untouched. ✅
- Reader handles DOCX/PDF/scanned/images/Office + Google-native → Task 4 (Office via Gotenberg) + existing `geminiRead` (images/PDF/scans) + Task 5 (Google-native export to PDF). ✅
- Incremental sync by `modifiedTime`; deleted removal → Tasks 6, 8. ✅
- Metadata `{driveFileId, filename, webUrl, chunkIndex, modifiedTime}` → Task 8. ✅
- Index persists; only sync writes it → Tasks 3, 8 (no query path here; that's 2b). ✅
- `library_documents` sync-state table → Task 2, repo Task 7. ✅
- `POST /library/sync` admin-gated + `GET /library/status` → Task 9. ✅
- Per-file failure isolation → Task 8 (try/catch per file, `failed` status). ✅
- Manual button (frontend) → Task 10. ✅
- DB boundary (no `db` in `src-langchain`) → DB ops only in `src/library/repo.ts`, `src/library/sync.ts`. ✅
- **Out of scope (correctly absent):** library query / chat toggle (that's Milestone 2b), sparse/hybrid, scheduled sync, Neo4j.

**Placeholder scan:** every code step shows real code; `googleapis` and Qdrant-client calls carry an explicit "confirm via context7" note (version-sensitive), not placeholders.

**Type consistency:** `DriveFile` (Task 5) is consumed by Tasks 6 + 8; `LibraryDocument`/`NewLibraryDocument` (Task 2) by Tasks 7 + 8; `runSync` (Task 8) + `summary` (Task 7) by Task 9. `classifyFiles` takes `{driveFileId, modifiedTime}[]` and `listIndexed` returns `LibraryDocument[]` (a superset) — Task 8 passes the rows directly, structurally compatible.
