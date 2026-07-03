# Vector Library Phase 1 — Deploy Runbook

Source branch: `dev2` @ `7c51441..2654d33` (code complete, 161/161, tsc clean).
Deploy branch: `vps-backend` (62 behind / 318 ahead of dev2 — port additively, NEVER merge).

Legend: **[me]** = doable from this session · **[you]** = needs the VPS / secrets.

---

## Key reconciliation fact

`vps-backend` already carries the OLD `src-langchain` Drive library:
- `backend/src/library/sync.ts`, `diff.ts`, old `/library/sync` route.
- old `library_documents` schema (PK `drive_file_id`) + its migration.
- `src-langchain` imports.

Phase 1 **removes** all of that and replaces it with the backend-driven Qdrant
library. The port must delete-old + add-new, resolving those exact conflicts.

---

## Step A — Port Phase 1 onto `vps-backend`  **[me]**

Done in an isolated worktree so your working tree is untouched; nothing pushed
until you review.

1. Worktree from `origin/vps-backend`.
2. Remove the old library (mirror dev2 Task 1): delete `sync.ts`/`diff.ts` (+tests),
   drop the `/library/sync` route + `runSync`/`src-langchain` library imports.
3. Apply the new modules: `chunker`, `embeddings`, `vector-store`, `text-extract`,
   `ingest`, `retrieve`; generalized `library_documents` schema + migration `0007`;
   `routes.ts` (upload/list/delete/status); `libraryDocs` threading in `n8n-client`
   + `provider`; gated retrieval in `chat-routes` (ask + regenerate).
4. Reconcile conflicts (old schema/routes vs new). Keep vps-backend's OTHER
   divergent features intact — only touch the library surface.
5. `npx vitest run` + `npx tsc --noEmit` green.
6. Push `vps-backend` (no deploy happens from the push alone).

## Step B — Infra on the VPS  **[you]**

In `/opt/rag-skripsi-stack`:
1. Add a **Qdrant** service to the compose stack (e.g. `qdrant/qdrant`, expose 6333
   on the internal network only).
2. Set backend env for `rag_backend`:
   - `QDRANT_URL=http://qdrant:6333` (compose service name)
   - `OPENAI_API_KEY=<real OpenAI key with embedding access>`  ← NOT the capped OpenRouter key
   - (defaults are fine: `QDRANT_COLLECTION_LIBRARY=project_rag_library`, `EMBED_MODEL=text-embedding-3-small`)

## Step C — Deploy backend + migrate  **[you]**

1. Pull `vps-backend` on the VPS; rebuild the `rag_backend` container.
2. Apply the migration: `npx tsx src/db/migrate.ts` (or the container's migrate step).
   - ⚠️ Migration `0007` is a destructive DROP+CREATE of `library_documents`. The
     old table was only ever populated if the old Drive Sync ran — per notes, Part B
     Sync needed secrets+Gotenberg and likely never indexed, so the drop should be
     safe. Confirm the old table is empty (or you don't need its rows) before applying.

## Step D — Edit the live n8n `RAG Query` workflow  **[me]**

Additive change so it accepts + labels `libraryDocs` (backup already at
`n8n/backups/RAG-Query-2026-07-03-before.json`; exact node steps in
`docs/superpowers/plans/2026-07-03-library-vector-upload.md` Task 12):
1. `Normalize Input` → pass through `libraryDocs`.
2. New `Library Docs To Rows` node → feeds `Merge Loads` input 0.
3. `Build Context and Sources` → label those rows `origin: 'Library'`.
4. `validate_workflow` → publish. Do this AFTER the backend is deployed (before that
   it's inert — safe but pointless).

## Step E — Smoke test  **[together]**

1. As an admin, `POST /library/documents` with a real doc → expect `200 {id,status:"indexed",chunkCount}`.
2. Ask a **synonym** question (wording different from the doc) → expect the answer to
   retrieve + cite the doc with `origin: Library`.
3. Ask a generic/creative question → confirm the library is skipped (intent gate) and
   normal answers are unaffected.
4. Tune `LIBRARY_SCORE_THRESHOLD` (currently 0.2 in `retrieve.ts`) against real hits.

---

## Rollback
- Backend: redeploy the prior `vps-backend` commit.
- n8n: re-import `n8n/backups/RAG-Query-2026-07-03-before.json`.
- DB: migration is destructive; only the (empty) library table is affected.
