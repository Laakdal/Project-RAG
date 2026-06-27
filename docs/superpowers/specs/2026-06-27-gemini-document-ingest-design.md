# Gemini Multi-Filetype Document Ingest — Design

**Date:** 2026-06-27
**Status:** Approved design (pre-implementation). Next step: implementation plan.

## Goal

Let the RAG assistant read content from **many document types** — images, PDFs,
DOCX, Excel (XLSX), PowerPoint (PPTX), and the plain text/data formats
(TXT/MD/CSV/JSON/HTML) — using **Gemini 2.5 Flash** as the reader, called over
**HTTP** from n8n. The capability applies to **both** ingest paths: per-chat
uploads (live today) and a shared Google Drive knowledge library.

This consolidates and supersedes the earlier reader choices:
- `2026-06-26-ocr-vision-ingest-design.md` (which used `gpt-4o-mini`) — replaced by Gemini 2.5 Flash.
- `2026-06-25-drive-library-and-filetypes-design.md` (which used OpenAI for OCR + embeddings) — the file-type/library architecture is carried forward, but standardized on Gemini.

## Locked decisions

1. **Reader:** **Gemini 2.5 Flash**, called via the n8n **HTTP Request** node (`generateContent`). Reads PDFs and images natively; verbatim transcription + figure/chart descriptions.
2. **Office formats reach Gemini by conversion:** Gemini cannot ingest DOCX/XLSX/PPTX binaries, so a self-hosted **Gotenberg (headless LibreOffice)** container converts them to PDF first. Highest fidelity (native charts survive), fully private.
3. **One uniform reading sub-flow** in n8n, reused by both ingest paths. Office → PDF; images/PDFs pass through; text/code formats are extracted directly (no Gemini).
4. **Provider:** standardize the whole pipeline on **Gemini / one API key**:
   - **Read** → Gemini 2.5 Flash.
   - **Generate** the chat answer → Gemini 2.5 Flash, with **Google Search grounding** (replaces the prior OpenAI `web_search`; keeps hybrid docs+web).
   - **Embed** chunks → a **Gemini embedding model** (e.g. `gemini-embedding-001`) — a separate model, same key.
5. **Scope:** both **per-chat upload** and **Google Drive library** ingest paths.
6. **Resilience:** Gemini failure (or Gotenberg failure) falls back to existing **text-layer extraction** so an ingest never fully fails.
7. **XLSX special case:** spreadsheets get **both** complete cell-text extraction **and** a Gemini-on-PDF pass (see below), because PDF conversion can clip wide sheets.

## Current state (what exists today)

- **Per-chat ingest is live and text-only.** Backend (`backend/src/rag/chat-routes.ts`) accepts only `application/pdf` and the DOCX MIME (`ALLOWED_MIME`), forwards the **raw file binary** to the n8n `rag-ingest` webhook, and stores the original bytes for preview. n8n extracts text (PDF → `extractFromFile`, DOCX → `docxLoader`), chunks (800/100), embeds, and upserts to the per-chat Qdrant collection tagged `conversationId`.
- **Images, screenshots, scanned pages, embedded figures, and Office formats beyond DOCX are never read.**
- **Embedding/generation provider has churned** across the prior specs (Gemini `gemini-embedding-001` 3072 in the as-built note; OpenAI `text-embedding-3-small` 1536 in later specs; a Gemini HTTP-batch embed verified per project memory). The **live embedding model/dimension is confirmed during the feasibility spike** (see Phase 0) before any collection work.

## Architecture overview

Everything centers on one reusable sub-flow that turns any supported file into
text. Both ingest paths call it; only the storage tagging differs.

```
  Per-chat upload ─┐
  (backend → n8n   │        ┌──────────── Shared "Read Document" ────────────┐
   rag-ingest)     ├───────►│  Route by type (Switch on MIME/extension)      │
                   │        │   ├─ PDF ─────────────────────► Gemini 2.5     │──► Markdown
  Drive sync ──────┘        │   ├─ image (PNG/JPEG/…) ──────► Flash  (HTTP)  │     text
  (new RAG Library          │   ├─ Office (DOCX/XLSX/PPTX) ─► Gotenberg→PDF  │      │
   Sync workflow)           │   │                             → Gemini       │      │
                            │   └─ text/code (TXT/MD/CSV/…) ─► extract text   │      │
                            │   (Gemini error → fall back to text extraction)│      │
                            └────────────────────────────────────────────────┘      │
                                                                                     ▼
                                                 chunk (800/100) → embed (Gemini) → Qdrant
                                       per-chat → existing collection, tag conversationId
                                       library  → new collection, tag driveFileId, scope:"library"
```

## Components

### A. Shared "Read Document" sub-flow (the heart of this work)

**Input:** file binary + filename/MIME + ingest metadata. **Output:** Markdown text.

1. **Route by type** — a Switch node branches on MIME/extension into four lanes:
   - **PDF** → Gemini (reads PDFs natively, vision + text).
   - **Image** (PNG/JPEG/WEBP/…) → Gemini.
   - **Office** (DOCX/XLSX/PPTX) → **Gotenberg → PDF** → Gemini.
   - **Text/code** (TXT/MD/CSV/JSON/HTML) → **direct text extraction**, no Gemini (already plain text; a vision pass would only add cost/latency).
2. **Gemini "read → Markdown" node** (HTTP Request → `generateContent` on `gemini-2.5-flash`):
   - **Prompt:** transcribe **all** visible text **verbatim** — body text *and* text inside screenshots — do not summarize or omit; output tables as Markdown; **describe** figures/charts (clearly labeled as descriptions); mark unreadable spans `[illegible]`.
   - **File delivery — by size:** **inline base64** (`parts[].inlineData`) for small files (request under ~20 MB); **Gemini Files API** (resumable upload → reference via `parts[].fileData.fileUri`) for larger files up to the 50 MB cap. Exact cutoff pinned by the spike.
   - **Auth:** API key via an n8n Header/query-param credential the HTTP Request node can attach (sidesteps the prior "MCP won't attach a cred to httpRequest" dead-end).
3. **Fallback** — on Gemini error (429 / timeout / 5xx / oversize), fall back to the existing **text-layer extraction** (`extractFromFile` / `docxLoader` / sheet / text). An image with no text layer → skip (no text); ingest still completes.
4. **Output** Markdown → the normal **chunk → embed → store** tail (only the collection/tags differ per path).

### B. Path A — Per-chat upload (live path; ships first)

- **Backend** (`chat-routes.ts`): expand `ALLOWED_MIME` from `{PDF, DOCX}` to add **PNG, JPEG, WEBP, XLSX, PPTX, TXT, MD, CSV, JSON, HTML**; update the "Only PDF and DOCX…" error message. `INLINE_SAFE_MIME` (preview allowlist) already covers PDF/PNG/JPEG — no security change; WEBP and Office/text continue serving as neutral downloads (script-safe, just not inline-previewed). The forward-raw-binary mechanism is unchanged.
- **Frontend:** update the upload accept-list + helper — `CHAT_ATTACHMENT_ACCEPTED_MIMETYPES`, the "Supports:" UI text, and `isFileTypeSupported`.
- **n8n `rag-ingest`:** replace today's route + text-only extraction with the shared **Read Document** sub-flow. Downstream chunk → embed → upsert unchanged; writes to the **existing per-chat collection**, tagged `conversationId`.

### C. Path B — Google Drive library sync (new `RAG Library Sync` workflow)

- **Trigger:** Google Drive Trigger on **one folder**, watching `fileCreated` + `fileUpdated`, poll ~10 min. (Recursive subfolders deferred.)
- **Acquire the binary** (the one extra step vs. Path A):
  - **Google-native** (Google Docs / Sheets / Slides) have no downloadable binary → **Drive export → PDF** (Drive renders it, images included — *no Gotenberg*), then into the shared sub-flow. A PDF export is a full visual render, so embedded images survive and Gemini reads them. (Exporting to `text/plain` would drop images, so we do **not** do that.)
  - **Everything else** (uploaded PDF / image / DOCX / XLSX / PPTX / text) → **download binary** → shared sub-flow (Office still routes through Gotenberg there).
- **Edit-replace (no duplicates):** before upserting, **delete this file's existing chunks** — an HTTP Request to Qdrant `points/delete` filtered on `metadata.driveFileId == <id>` — then chunk → embed → upsert.
- **Storage:** a **separate** collection `project_rag_library`, payload `{ content, metadata:{ driveFileId, filename, modifiedTime, chunkIndex, scope:"library" } }`, created at the Gemini embedding dimension (Cosine).
- **Deletes-from-Drive** are not auto-removed in v1 (the `driveFileId` tag is groundwork for a later reconcile job).

### D. Query merge + answer generation (modify `RAG Query`)

A chat now searches **both** collections.

1. **Embed the question once** (the same Gemini embedding model both collections use).
2. **Two Qdrant loads** off that single embedding: the **per-chat** collection (filter `metadata.conversationId`) and **`project_rag_library`** (no conversation filter).
3. **Merge** in *Build Context and Sources*: **chat-upload chunks first**, then library; **dedup**; keep `score ≥ 0.25`; cap to a combined top-K (~6); tag each source's **origin** ("This chat" vs "Library").
4. **Generate** with **Gemini 2.5 Flash** + **Google Search grounding** (hybrid docs+web); same grounding prompt: answer only from the provided context and say so when absent. Map grounding citations into the existing `sources` shape.
5. Return `{answer, sources}` — unchanged contract; sources carry an origin tag.

### E. Gotenberg (new container)

Headless LibreOffice service in the deployment stack. n8n posts the Office binary
to Gotenberg's LibreOffice route and receives a PDF. Self-hosted → company
documents never leave the infrastructure. Office text extraction remains the
fallback if Gotenberg is unavailable.

## Data model (Qdrant)

- **Per-chat** (existing collection): `{ content, metadata:{ conversationId, filename, chunkIndex } }`.
- **Library** (new `project_rag_library`): `{ content, metadata:{ driveFileId, filename, modifiedTime, chunkIndex, scope:"library" } }`.
- Both at the **Gemini embedding dimension**, Cosine, embedded by the **same** model so one question-embedding searches both. The spike confirms the live per-chat dimension: if it's already Gemini, no rebuild; if it's a different model/dim, the per-chat collection needs a rebuild + re-ingest. The library collection is created fresh at the Gemini dimension regardless.

## File-type coverage

| Type | Paths | Reader | Fallback |
|---|---|---|---|
| PDF | both | Gemini (PDF) | `extractFromFile` |
| PNG / JPEG / WEBP | both | Gemini (image) | skip (no text) |
| DOCX | both | Gotenberg→PDF→Gemini | `docxLoader` |
| PPTX | both | Gotenberg→PDF→Gemini | unzip slide XML text |
| XLSX | both | cell-text **+** Gotenberg→PDF→Gemini (see below) | cell/CSV text |
| TXT / MD / HTML | both | direct text extract | — |
| CSV / JSON | both | direct text extract | — |
| Google Doc / Sheet / Slides | Drive only | Drive export→PDF→Gemini | export→text |

### XLSX special handling (the one exception to the uniform flow)

Converting a **wide** spreadsheet to PDF can **clip** columns past the page edge,
so Gemini wouldn't see them. XLSX therefore gets **both**:
- **cell text / CSV extraction** — complete, no clipping (captures all rows/columns), and
- a **Gotenberg→PDF→Gemini** pass — captures embedded **charts/images**.

The two outputs are concatenated into the text we chunk and embed. Every other
format stays on the single uniform path.

## Error handling / resilience (never block an ingest)

- **Gemini call fails** (429 / timeout / 5xx / oversize) → fall back to text-layer extraction. Image with no text layer → skip; ingest still completes.
- **Gotenberg conversion fails** → fall back to text-extract of the original Office file.
- **Files-API upload fails** → same fallback chain.
- Backend keeps existing guards: oversize → **413**, unsupported type → **400**.
- Guarantee: worst case, the document's plain text is still indexed.

## Phasing — each phase ends with a working app

- **Phase 0 — Feasibility spike** (de-risk before building; see below).
- **Phase 1 — Per-chat reading (core win, on the live path):** add the **Gotenberg** container; build the shared **Read Document** sub-flow; wire it into **`rag-ingest`**; expand the **backend allowlist** + **frontend accept-list**. Outcome: per-chat uploads of image / PDF / DOCX / XLSX / PPTX / text are all read by Gemini. Shippable and testable on its own. *No RAG Query changes.*
- **Phase 2 — Drive library + full Gemini query:** new **RAG Library Sync** workflow (reuses the sub-flow) + `project_rag_library` collection + edit-replace; **and** modify **RAG Query** once for (a) the **two-collection merge** (chat first, then library) and (b) **generation on Gemini 2.5 Flash + Google Search grounding**. Both RAG Query edits land together so the workflow is touched only once. Outcome: shared library answerable from any chat; one Gemini key end-to-end; hybrid docs+web.

Phases 1–2 depend on spike items #1–#3.

## Phase 0 — Feasibility spike (validate the risky unknowns first)

1. **Gemini reads a PDF via HTTP from n8n** — inline base64 *and* the **Files API** path for large files; confirm the HTTP Request node attaches the **API-key credential** cleanly.
2. **Fidelity** — transcription accuracy + page order on a real **text + screenshot** PDF (a SISOP journal); confirm screenshot text comes through **verbatim**.
3. **Gotenberg** — DOCX/XLSX/PPTX → PDF in the stack; confirm embedded images survive; observe the **wide-XLSX clipping** that justifies the cell-text + PDF combo.
4. **Cost & latency** per document; behavior on a large/many-page PDF (when the Files API becomes necessary; any size/token limits).
5. **Live embedding model/dimension** — confirm what the per-chat collection uses → whether a rebuild is needed and what dimension `project_rag_library` should be.
6. **Gemini Google Search grounding** — request shape and how citations come back, for the Phase 2 generation swap.

If direct-PDF or Gotenberg proves unreliable or too costly, revisit before building.

## Testing (integration-style — n8n isn't unit-testable)

Run a fixture set through live ingest and inspect Qdrant + the answers:
- pure-text PDF (still works) · scanned PDF (now readable) · text+screenshot PDF / SISOP journal (screenshot answerable) · standalone PNG · DOCX with an embedded screenshot · PPTX image slides · **wide XLSX with a chart** (all columns *and* chart captured) · TXT/CSV/JSON · **Google Doc with an image** (library path).
- **Failure drills:** force a Gemini error → falls back to text extraction, still ingests; force a Gotenberg error → Office falls back to text.
- **Drive:** drop a Google Doc → answerable from any chat with a "Library" source; edit it → old chunks gone, no duplicates; a chat with both a personal upload and a library doc ranks the **personal upload first**.
- **Backend:** extend `chat-routes.test.ts` for the expanded allowlist (accept new types, reject unsupported, oversize → 413).

## Prerequisites (user, one-time)

- A **Gemini API key** available to n8n as an HTTP credential (key for `gemini-2.5-flash`, the Gemini embedding model, and Files API).
- **Gotenberg** container added to the deployment stack, reachable from n8n.
- A **Google Drive OAuth2** credential in n8n with access to the library folder; record the **folder ID** (Phase 2).
- `project_rag_library` collection (auto-created on first ingest, or pre-created at the Gemini dimension / Cosine) (Phase 2).

## Out of scope / deferred

- **Cost-optimized selective reading** (skip Gemini for pure-text docs) — every PDF/image/Office file gets a Gemini pass; revisit only if cost demands it.
- **Backend-orchestrated per-page reading** — AI work stays in n8n.
- **Auto-removing files deleted from Drive** — a later reconcile job; the `driveFileId` tag is the groundwork.
- **Recursive subfolders / multiple Drive folders** — single folder for v1.
- **Per-user Drive auth** — one shared folder/owner.
- **Re-ingesting documents uploaded before this ships.**

## Success criteria

- Upload an **image / scanned PDF / text+screenshot PDF** in a chat → its visible text (incl. text inside screenshots) becomes answerable.
- Upload a **DOCX/PPTX with an embedded screenshot** → the screenshot's text is answerable.
- Upload a **wide XLSX with a chart** → all columns' data **and** the chart are captured.
- Upload a **.txt / .csv / .json** → ingested and answerable.
- *(Phase 2)* Drop a **Google Doc with an image** in the library folder → within a poll cycle it's answerable from **any** chat, with a "Library" source; **edit** it → answers reflect the new content with no duplicates.
- *(Phase 2)* A chat with **both** a personal upload and a relevant library doc ranks the **personal upload first**.
- A forced **Gemini failure** still ingests the document's plain text (no fully-failed upload).
