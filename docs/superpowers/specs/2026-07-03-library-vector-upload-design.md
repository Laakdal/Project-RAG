# Persistent Vector Library — Phase 1 (Upload)

Date: 2026-07-03
Status: Design approved, ready for implementation plan
Scope: Phase 1 (direct upload). Phase 2 (Drive) documented as follow-on.

## Summary

Add a persistent, shared, semantically-searchable document library to the RAG
chat app. Admins upload documents into the library; the backend indexes them into
a Qdrant vector store; at query time the backend searches that store and feeds the
matching chunks to the existing n8n `RAG Query` workflow as extra context.

The live n8n workflows (`RAG Read`, `RAG Query`) keep their current jobs. The
**backend** is the only thing that talks to Qdrant — it does the embedding,
upserting, and searching. This is the key difference from the original,
abandoned design where n8n drove Qdrant (which failed because n8n could not
reliably attach the embedding credential to its HTTP node).

## Background / Why

The current live setup answers document questions two ways, neither of which is a
persistent, searchable corpus:

- **Per-chat upload** — file text is used whole-in-context for that one
  conversation, then discarded. Not reusable across chats.
- **Google Drive** — on-demand keyword search reads the single top-matching file
  at query time. Nothing is pre-indexed.

This breaks at the target scale (50–100 documents) and query style (users ask in
their own synonyms, not the document's wording):

1. Nothing persists — there is no shared library.
2. Drive keyword search misses synonyms (e.g. "claim a taxi" vs a doc titled
   "Reimbursement Procedure").
3. Only one file is read per question — no cross-document answers.
4. Whole-doc-in-context cannot scale to 50–100 documents per query.
5. No relevance ranking — the top keyword hit, not the most meaningful passage.

Semantic vector retrieval solves all five: chunk the corpus once, retrieve only
the meaningfully-relevant passages at query time.

## Goals

- A persistent, shared, admin-curated document library owned by the app (not tied
  to a single chat, not dependent on Google Drive).
- Semantic (meaning-based) retrieval that scales to hundreds of documents.
- Zero regression to the live per-chat upload, on-demand Drive, and web paths.

## Non-goals (Phase 1)

- Google Drive sync (Phase 2).
- Per-user private libraries (library is shared / admin-curated).
- Storing the original uploaded file bytes for the library (Phase 1 stores
  extracted text + chunks + metadata only; re-indexing means re-uploading).
- pgvector / "own database" migration (explicitly set aside).
- Removing the on-demand Drive keyword lookup (retired in Phase 2, not now).

## Constraints

- **Do not import `backend/src-langchain/`.** It is an abandoned path. All new
  vector code lives in the live `src/` tree. Text extraction reuses the live n8n
  `RAG Read` webhook, not `src-langchain/ingest/read.ts`.
- Reuse the `@langchain/qdrant` and `@langchain/openai` npm packages (already in
  `package.json`) in fresh `src/library/` files — never importing the
  `src-langchain` directory.
- Keep the live n8n workflows working; changes to `RAG Query` must be additive.

## Locked decisions

| Decision | Choice |
|---|---|
| Vector store | Qdrant container, collection `project_rag_library` |
| Who drives Qdrant | Backend only (embedding, upsert, search) |
| Embeddings | OpenAI `text-embedding-3-small` (1536 dims), direct API key |
| Text extraction | Reuse live n8n `RAG Read` webhook |
| Library scope | Shared, admin-curated |
| Query trigger | Intent-gated (+ explicit `useLibrary` override) |
| Query integration | Backend searches Qdrant, injects hits into `rag-query` |
| Ingestion source (P1) | Direct admin upload |

## Architecture

The backend is the hub. n8n and Qdrant never talk to each other.

### Ingestion (write path) — backend + n8n reader, no Qdrant in n8n

```
Admin uploads a file
  → POST /library/documents            (BACKEND, admin-only)
      → n8n RAG Read webhook           (extract text — reuse live reader)
      → chunk (1000 chars, 150 overlap)
      → embed each chunk (OpenAI text-embedding-3-small)
      → upsert vectors to Qdrant `project_rag_library`
          (payload metadata: sourceId, filename, chunkIndex, source='upload')
      → record/refresh row in Postgres `library_documents`
      → respond {id, status, chunkCount}
```

### Query (read path) — backend orchestrates, n8n unchanged in behavior

```
User sends a message
  → POST /conversations/:id/messages   (BACKEND)
      → decide whether to search the library:
          explicit useLibrary === true  → search
          else                          → intent gate (cheap LLM classify)
      → if searching:
          embed question (OpenAI)
          Qdrant top-k similarity search (k=8, drop hits below score threshold)
          → library chunks (text + filename)
      → call n8n rag-query, adding the chunks as `libraryDocs`
      → n8n merges libraryDocs into context alongside its existing sources
      → answer + sources back to user
```

## Components

All new code under `backend/src/library/` unless noted.

### 1. `embeddings.ts`
- Thin wrapper constructing an `OpenAIEmbeddings` (model `text-embedding-3-small`)
  from `OPENAI_API_KEY` and `EMBED_MODEL` config.
- Throws a clear error if `OPENAI_API_KEY` is missing.

### 2. `vector-store.ts`
- Owns the Qdrant connection (`QDRANT_URL`, collection
  `QDRANT_COLLECTION_LIBRARY`).
- `upsertChunks(sourceId, filename, chunks: string[])` — embeds and upserts,
  tagging each point's payload with `{ sourceId, filename, chunkIndex, source }`.
- `search(question, k)` — similarity search returning `{ filename, chunkIndex,
  text, score }[]`.
- `deleteBySource(sourceId)` — removes all points for a document (used on
  re-upload / delete).
- Collection is created on first use if absent (vector size 1536, cosine).

### 3. `chunker.ts`
- `RecursiveCharacterTextSplitter`, `chunkSize: 1000`, `chunkOverlap: 150`
  (matches prior conventions). Pure function, easily unit-tested.

### 4. `text-extract.ts`
- `extractText(file: Buffer, filename, mimeType): Promise<string>` — POSTs the
  file to the live n8n `RAG Read` webhook and returns `{text}`. Reuses the
  existing reader; no document parsing in the backend.

### 5. `ingest.ts`
- `indexLibraryDocument({ sourceId, filename, mimeType, file, source })`:
  extract → chunk → `deleteBySource` (clear stale chunks on re-index) →
  `upsertChunks` → upsert `library_documents` row (status `indexed` / `failed`,
  `chunkCount`, `lastError`). Returns `{ status, chunkCount }`.
- This is the shared entry point Phase 2 (Drive) will also call.

### 6. `retrieve.ts`
- `searchLibrary(question, k=8): Promise<QuerySource[]>` — embed + Qdrant search,
  filter by score threshold, map to `{ filename, chunkIndex, text }`.
- `shouldSearchLibrary(question, history): Promise<boolean>` — the intent gate: a
  cheap LLM classification ("is this asking about a specific document / the
  library?") mirroring the existing n8n `Intent Check`. Returns false for
  generic/creative/small-talk so we skip the embed+search cost.

### 7. `repo.ts` (extend existing)
- Generalize the key from Drive-specific to a source-agnostic model (see Data
  Model). Keep `listIndexed`, `upsertDocument`, `deleteDocument`, `summary`.

### 8. `routes.ts` (extend existing `libraryRouter`, admin-only)
- `POST /library/documents` — multipart upload (multer, memory, 50 MB cap,
  reuse `isAllowedUpload`). Calls `indexLibraryDocument`. Returns
  `{ id, status, chunkCount }`.
- `GET /library/documents` — list indexed documents (for an admin UI).
- `DELETE /library/documents/:id` — `deleteBySource` + delete the row.
- `GET /library/status` — existing counts/last-sync summary (kept).

### 9. Query integration (`chat-routes.ts` + `rag/n8n-client.ts`)
- Remove the `src-langchain` `queryLibrary` import/branch (lines ~312–314).
- In the ask + regenerate paths: compute library chunks via `retrieve.ts`
  (gated), then pass them to `queryRag(..., libraryDocs)`.
- `n8n-client.queryRag` gains an optional `libraryDocs` parameter, included in the
  POST body to `rag-query`.

### 10. n8n `RAG Query` change (minimal, additive)
- `Normalize Input` passes through a new `libraryDocs` array (currently it drops
  unknown fields).
- A new node ("Library Docs To Rows") converts `libraryDocs` into library-origin
  rows feeding `Merge Loads` (index 0), so `Build Context and Sources` labels them
  `origin: 'Library'`. Existing per-chat `docs` and Drive behavior are untouched.
- Backed up before editing (export the workflow JSON to the repo).

## Data model

Generalize `library_documents` so it is not Drive-specific (uploads have no Drive
id). Migration via Drizzle:

```
library_documents
  id           uuid  primary key default random
  source       text  not null            -- 'upload' | 'drive' (P2)
  source_ref   text                        -- drive file id for P2; null for uploads
  filename     text  not null
  mime_type    text  not null
  chunk_count  integer not null default 0
  status       text  not null             -- 'indexed' | 'failed'
  last_error   text
  modified_time text                       -- P2 (Drive change detection); null for uploads
  web_url      text                        -- P2; null for uploads
  indexed_at   timestamptz not null default now()
```

`sourceId` used in Qdrant payloads = the `id` (uuid). Migration note: the current
table is PK'd on `drive_file_id`; the migration adds `id`/`source`/`source_ref`
and repoints the PK. No live library data depends on the old shape (library is not
active in production), so a straightforward migration is acceptable.

## Config / env

Already present in `config.ts` (reused, no new names needed):
- `QDRANT_URL` (required for the library path; validated at use with a clear error)
- `QDRANT_COLLECTION_LIBRARY` (default `project_rag_library`)
- `OPENAI_API_KEY` (required for embeddings)
- `EMBED_MODEL` (default `text-embedding-3-small`)
- `N8N_BASE_URL` (existing; used for the `RAG Read` call)

## Error handling

- Missing `QDRANT_URL` / `OPENAI_API_KEY` → the library path throws a clear,
  actionable error; the default chat path (no library) is unaffected.
- Upload ingest failure (reader down, no text, embed error) → persist a `failed`
  `library_documents` row with `last_error`; respond `{ status: 'failed' }`. No
  partial/orphaned vectors (delete-before-upsert ordering).
- Query-time library failure (Qdrant down, embed error) → log and treat as "no
  library results"; the chat still answers from n8n's other sources. Library
  retrieval must never take down a normal answer.

## Security / access control

- Library write + management routes are admin-only (`requireAuth` +
  `requireAdmin` + `requireCsrf`), matching the existing `libraryRouter`.
- Query-time library search is available to any authenticated user (shared
  corpus), read-only.
- Reuse `isAllowedUpload` for file-type validation; reuse the 50 MB cap.

## Testing strategy (vitest, matching existing suites)

- `chunker.test.ts` — chunk sizes/overlap, empty input.
- `embeddings.test.ts` — model/key wiring; clear error when key absent (mocked).
- `vector-store.test.ts` — upsert/search/delete against a mocked Qdrant client;
  payload metadata shape; collection auto-create.
- `text-extract.test.ts` — RAG Read call shape; error on non-ok.
- `ingest.test.ts` — happy path chunkCount; failure persists a `failed` row and no
  vectors; re-index clears stale chunks first.
- `retrieve.test.ts` — score-threshold filtering; mapping to `QuerySource`;
  intent gate true/false cases (mocked LLM).
- `routes.test.ts` — admin-only enforcement; upload happy/failed; list/delete.
- `chat-routes` — library chunks passed to `queryRag` when gated on; skipped when
  gated off; library failure degrades gracefully.

## Deployment

- Qdrant container must run in the integrated VPS stack (`/opt/rag-skripsi-stack`),
  reachable from the backend as `QDRANT_URL` (private hostname).
- Backend env needs `OPENAI_API_KEY` (direct key with embedding access — not the
  capped OpenRouter key that failed previously) and `QDRANT_URL`.
- Follow the branch workflow: build on `dev2`, port additively to `vps-backend`
  for deploy (never merge the two). Export the edited `RAG Query` workflow JSON
  into the repo as the backup.

## Phase 2 — Google Drive (follow-on, not built now)

- Point the same `indexLibraryDocument` pipeline at a Drive folder: list folder →
  diff against `library_documents` (added/modified/deleted via `modified_time`) →
  re-index changed files with `source='drive'`, `source_ref=<driveFileId>`.
- Rebuilt fresh in `src/` (no `src-langchain`); needs the Google service-account
  secret and Gotenberg for Office→text.
- Once Drive is in the vector library, retire the n8n on-demand Drive keyword
  lookup (it is the weaker, synonym-blind mechanism). Decision deferred to P2.

## Open questions

- Exact score threshold and `k` — tune during implementation against real docs.
- Intent-gate model — reuse the Gemini used by n8n's `Intent Check`, or a small
  OpenAI model; decide in the plan (both are cheap; pick by which key is healthiest).
