# Gemini Multi-Filetype Document Ingest — Phase 0 + Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let per-chat uploads of image / PDF / DOCX / XLSX / PPTX / text files be read by Gemini 2.5 Flash (via n8n HTTP Request), with Office formats converted to PDF by a Gotenberg container first.

**Architecture:** A single reusable n8n "Read Document" sub-flow routes each file by type — PDF and images go straight to Gemini 2.5 Flash; DOCX/XLSX/PPTX are converted to PDF by Gotenberg then read by Gemini; plain text/data formats are extracted directly. On any Gemini/Gotenberg failure it falls back to text-layer extraction so an ingest never fully fails. The backend (Express) only widens its upload allowlist; the frontend widens its accept-list; the reading itself stays entirely in n8n.

**Tech Stack:** Express + TypeScript + Vitest (backend), Next.js + TypeScript (frontend), n8n (orchestration, edited via the n8n MCP), Gotenberg (headless LibreOffice, Docker), Qdrant (vectors), Gemini 2.5 Flash + a Gemini embedding model (one API key).

**Scope of THIS plan:** Phase 0 (feasibility spike) + Phase 1 (per-chat multi-filetype reading). **Phase 2 (Google Drive library sync + the RAG Query merge + generation-on-Gemini-with-grounding) is a SEPARATE plan**, written after this ships and the spike resolves the open unknowns (live embedding dimension, inline-vs-Files-API cutoff, grounding citation shape). Source spec: `docs/superpowers/specs/2026-06-27-gemini-document-ingest-design.md`.

## Global Constraints

Every task's requirements implicitly include this section.

- **Branch workflow:** canonical dev branch is **`dev2`** (work here). Backend code changes are cherry-picked onto **`vps-backend`** for the VPS deploy. (project memory: `branch-workflow.md`)
- **Deploy target:** the live deploy is the integrated stack **`/opt/rag-skripsi-stack`** on the VPS (backend service `rag_backend`, plus `rag_n8n`, `qdrant`, postgres, nginx on network `rag-skripsi-stack_default`). **Do NOT use `docker-compose.vps.yml`** (it stands up a phantom 2nd Postgres + unrouted backend). (project memory: `vps-deploy-target.md`)
- **Do NOT touch or restart** the live n8n, the n8n DB, qdrant, or postgres beyond what a task explicitly intends. If a change risks disrupting them, STOP and report.
- **Commit messages:** plain, imperative, **no conventional-commit prefixes** (no `feat:`/`fix:`), never mention "pipeshub". (project memory: `commit-message-style.md`)
- **Gemini access:** call Gemini via the n8n **HTTP Request** node. Auth uses an n8n **Header/query-param credential** the HTTP Request node attaches itself — NOT an MCP-attached credential (that was a dead-end). (project memory: `rag-chat-slice1-status.md`)
- **Qdrant collections** are created/managed **THROUGH the n8n Qdrant node**, never via raw curl (avoids the vector-name mismatch). (project memory: `qdrant-vector-name-mismatch.md`)
- **n8n workflows are NOT in git.** They are built/edited via the **n8n MCP** (claude.ai n8n) or the n8n editor and verified **by execution**, not unit tests. The live ingest workflow is webhook `rag-ingest`, id **`QwR8Ktmgu7h730ZQ`**.
- **Upload transport:** backend forwards the file to n8n as **multipart FormData** (fields: `conversationId`, `filename`, and a Blob part named `file` typed with the mimeType) to `${N8N_BASE_URL}/webhook/rag-ingest`. multer field name is **`file`**, 50 MB cap, in-memory.
- **Frontend has no running unit tests** (`frontend/vitest.config.ts` sets `include: []`). Verify frontend changes with `npx tsc --noEmit` + manual UI check, not unit tests.
- **Gemini reader prompt** (used everywhere a file is read): verbatim transcription of all visible text (body **and** text inside screenshots), Markdown output, tables as Markdown, `[Figure: ...]` descriptions for non-text figures, `[illegible]` for unreadable spans, no preamble.

---

## File Structure

**Created:**
- `backend/src/rag/upload-allowlist.ts` — single-responsibility module: the upload MIME/extension allowlist + `isAllowedUpload()` predicate. (Extracted so it is unit-testable in isolation.)
- `backend/src/rag/upload-allowlist.test.ts` — unit tests for `isAllowedUpload()`.
- `docs/vps-claude-gotenberg-deploy-brief.md` — VPS ops brief: the exact `gotenberg` service block + commands to add it to `/opt/rag-skripsi-stack/docker-compose.yml` and smoke-test it.

**Modified:**
- `backend/src/rag/chat-routes.ts` — replace the inline `ALLOWED_MIME` check in the upload guard with `isAllowedUpload()`; update the error message. (allowlist const lives at lines 29-32 today; guard at 364-367.)
- `backend/src/rag/chat-routes.test.ts` — re-point the existing negative test at a still-unsupported type; add accept-path coverage for new types.
- `frontend/app/(main)/chat/components/chat-input.tsx` — widen the **live** inline `SUPPORTED_FILE_TYPES` / `ACCEPTED_MIME_TYPES` / `ACCEPTED_EXTENSIONS` (lines 74-82); update the stale comment (line 74); set a concise "Supports:" label (lines 1204, 1614).
- `frontend/app/(main)/chat/types.ts` — extend the `SupportedFileType` union (line 303); delete the dead `CHAT_ATTACHMENT_ACCEPTED_MIMETYPES` export (lines 315-320).
- `docker-compose.yml` (repo root) — add a `gotenberg` service on `appnet` for local-dev parity.
- `docs/superpowers/specs/2026-06-27-gemini-document-ingest-design.md` — append an "As-built" note recording spike findings + the live rag-ingest details.

**Edited on the VPS (not in git):** `/opt/rag-skripsi-stack/docker-compose.yml` (add `gotenberg`); the n8n `rag-ingest` workflow (id `QwR8Ktmgu7h730ZQ`) via the n8n MCP.

---

## Phase 0 — Feasibility spike (de-risk before building)

These tasks validate the risky mechanisms and record findings. They are verified by **execution/observation**, not unit tests. Each ends by recording its finding in the spec's "As-built" section and committing that doc edit.

### Task 0.1: Capture the live `rag-ingest` workflow details

**Files:**
- Modify (record findings): `docs/superpowers/specs/2026-06-27-gemini-document-ingest-design.md`

**Interfaces:**
- Produces: the **live embedding model name**, **embedding dimension**, **Qdrant collection name**, and the current node graph of `rag-ingest` (esp. the PDF `extractFromFile` and DOCX `docxLoader` nodes that become the fallback). Phase 1's n8n task and the future Phase 2 plan both rely on these.

- [ ] **Step 1: Pull the workflow definition via the n8n MCP**

Call `get_workflow_details` with id `QwR8Ktmgu7h730ZQ`. (If the MCP requires it, first call `get_sdk_reference`.)

- [ ] **Step 2: Record the findings**

From the returned JSON, note and write into the spec's new "## As-built notes (2026-06-27)" section:
- the embedding node's model (e.g. `gemini-embedding-001`) and its dimension,
- the Qdrant collection name it upserts to and the metadata fields it tags,
- the exact node names of the PDF text extractor (`extractFromFile`) and DOCX loader (`docxLoader`) — these are the Task 1.5 fallback targets,
- the chunking parameters (expected 800 / 100).

Expected: the embedding model/dim are now known (resolves spec open-item "live embedding model/dimension"). If the dimension is NOT a Gemini dimension, flag it loudly in the note — it changes the Phase 2 collection plan (not Phase 1).

- [ ] **Step 3: Commit the recorded findings**

```bash
git add docs/superpowers/specs/2026-06-27-gemini-document-ingest-design.md
git commit -m "record live rag-ingest workflow details from spike"
```

### Task 0.2: Prove Gemini 2.5 Flash reads a PDF via n8n HTTP Request (inline)

**Files:** none in repo (throwaway n8n workflow + recorded finding in the spec).

**Interfaces:**
- Produces: a **working Gemini `generateContent` request body** (inline base64) and the **credential setup** that Task 1.5 reuses verbatim.

- [ ] **Step 1: Create the Gemini HTTP credential in n8n**

In n8n, create a **Header Auth** credential (or query-param) named `Gemini API Key` that the HTTP Request node can attach: header `x-goog-api-key: <GEMINI_API_KEY>`. (Do NOT rely on an MCP-attached credential.)

- [ ] **Step 2: Build a one-node throwaway workflow**

Add a Manual Trigger → HTTP Request node:
- Method `POST`, URL `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`
- Auth: the `Gemini API Key` credential from Step 1.
- Body (JSON), with `<BASE64>` = base64 of a small test PDF and the reader prompt from Global Constraints:

```json
{
  "contents": [
    { "parts": [
      { "inline_data": { "mime_type": "application/pdf", "data": "<BASE64>" } },
      { "text": "You are a document transcription engine. Transcribe ALL visible text exactly as it appears — body text and any text inside screenshots, photos, or figures. Do not summarize, paraphrase, or omit anything. Preserve reading and page order. Output clean Markdown; render tables as Markdown tables. For any non-text figure/chart/image, write a brief description on its own line prefixed with '[Figure: ]'. Mark unreadable spans as [illegible]. Output ONLY the transcription, no preamble." }
    ] }
  ],
  "generationConfig": { "temperature": 0, "maxOutputTokens": 8192 }
}
```

- [ ] **Step 3: Execute and verify the answer text comes back**

Run the node. Expected: HTTP 200; the transcription is at `candidates[0].content.parts[0].text`. Confirm the credential attached (no 401/403).

- [ ] **Step 4: Fidelity check on a real text+screenshot PDF**

Repeat Step 3 with a real SISOP journal PDF (instruction text + a code/terminal screenshot). Expected: the screenshot's text appears **verbatim** in the output, in roughly correct page order.

- [ ] **Step 5: Record the working request body + credential note, and commit**

Append to the spec's "As-built notes": the exact working body, the `candidates[0].content.parts[0].text` response path, and the credential type used. Also record the **per-call latency** and the response `usageMetadata` token counts (input/output) as a cost-per-document estimate (spike item #4).

```bash
git add docs/superpowers/specs/2026-06-27-gemini-document-ingest-design.md
git commit -m "record working Gemini inline read request from spike"
```

### Task 0.3: Prove the Gemini Files API path for a large PDF

**Files:** none in repo (throwaway workflow + recorded finding).

**Interfaces:**
- Produces: the **size cutoff** at which inline base64 fails and the **two-step Files API** call that Task 1.5 uses for large files.

- [ ] **Step 1: Find the inline ceiling**

Re-run Task 0.2's node with progressively larger PDFs (e.g. ~5 MB, ~15 MB, ~25 MB). Record the size at which it starts failing (request too large). Expected: inline works up to roughly ~20 MB total request; beyond that it fails.

- [ ] **Step 2: Build the Files API two-step**

- HTTP Request A — upload: `POST https://generativelanguage.googleapis.com/upload/v1beta/files` with the `Gemini API Key` credential and the raw PDF bytes (resumable upload protocol; follow the SDK reference if needed). Capture `file.uri` from the response.
- HTTP Request B — generate: same `generateContent` URL/credential as Task 0.2, but the file part is `{ "file_data": { "mime_type": "application/pdf", "file_uri": "<file.uri>" } }` instead of `inline_data`.

- [ ] **Step 3: Execute on a >20 MB PDF and verify**

Expected: upload returns a `file.uri`; generate returns transcription text. Confirm a large PDF that failed inline now succeeds.

- [ ] **Step 4: Record the cutoff + the Files API call shape, and commit**

```bash
git add docs/superpowers/specs/2026-06-27-gemini-document-ingest-design.md
git commit -m "record Gemini Files API path and inline cutoff from spike"
```

### Task 0.4: Stand up Gotenberg and prove Office→PDF conversion

**Files:** none in repo yet (the committable compose + brief are Task 1.4). This task is the live standup + observation.

**Interfaces:**
- Produces: a reachable `gotenberg` service and the confirmed **convert endpoint + multipart field name**; the observed **wide-XLSX clipping** behavior that justifies the XLSX dual-path.

- [ ] **Step 1: Run Gotenberg where n8n can reach it**

On the environment n8n runs in (VPS live stack, or a local stack for the spike), start `gotenberg/gotenberg:8` on the same docker network as n8n, service name `gotenberg`, no published host port. (The committable form is Task 1.4 / the deploy brief.)

- [ ] **Step 2: Smoke-test the LibreOffice convert route**

From a container on the same network (or an n8n HTTP Request node):

```bash
curl --request POST http://gotenberg:3000/forms/libreoffice/convert \
  --form files=@sample.docx -o out.pdf
```

Expected: `out.pdf` is a valid PDF rendering of the DOCX (open it / check the `%PDF` header). Repeat for a `.pptx` and a `.xlsx`.

- [ ] **Step 3: Observe wide-XLSX clipping**

Convert a deliberately **wide** spreadsheet (e.g. 25+ columns). Open the PDF: confirm columns past the page edge are clipped/split. This is the evidence that XLSX needs cell-text extraction **in addition to** the PDF render (Task 1.5).

- [ ] **Step 4: Record the convert endpoint, field name (`files`), and the clipping observation, and commit**

```bash
git add docs/superpowers/specs/2026-06-27-gemini-document-ingest-design.md
git commit -m "record Gotenberg convert route and wide-xlsx clipping from spike"
```

---

## Phase 1 — Per-chat multi-filetype reading

### Task 1.1: Backend — upload-allowlist module (TDD)

**Files:**
- Create: `backend/src/rag/upload-allowlist.ts`
- Test: `backend/src/rag/upload-allowlist.test.ts`

**Interfaces:**
- Produces: `isAllowedUpload(mimetype: string, filename: string): boolean`, plus `ALLOWED_MIME: Set<string>` and `ALLOWED_EXTENSIONS: Set<string>`. Task 1.2 consumes `isAllowedUpload`.

- [ ] **Step 1: Write the failing tests**

```ts
// backend/src/rag/upload-allowlist.test.ts
import { describe, it, expect } from "vitest";
import { isAllowedUpload } from "./upload-allowlist.js";

describe("isAllowedUpload", () => {
  it("accepts the existing types by MIME", () => {
    expect(isAllowedUpload("application/pdf", "a.pdf")).toBe(true);
    expect(
      isAllowedUpload(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "a.docx",
      ),
    ).toBe(true);
  });

  it("accepts the new office/image/text types by MIME", () => {
    expect(
      isAllowedUpload(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "a.xlsx",
      ),
    ).toBe(true);
    expect(
      isAllowedUpload(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "a.pptx",
      ),
    ).toBe(true);
    expect(isAllowedUpload("image/png", "a.png")).toBe(true);
    expect(isAllowedUpload("image/webp", "a.webp")).toBe(true);
    expect(isAllowedUpload("text/csv", "a.csv")).toBe(true);
    expect(isAllowedUpload("application/json", "a.json")).toBe(true);
  });

  it("falls back to the extension when the browser MIME is empty or octet-stream", () => {
    // browsers frequently send "" or application/octet-stream for .md/.csv/.json
    expect(isAllowedUpload("", "notes.md")).toBe(true);
    expect(isAllowedUpload("application/octet-stream", "data.csv")).toBe(true);
  });

  it("rejects genuinely unsupported types by both MIME and extension", () => {
    expect(isAllowedUpload("application/zip", "archive.zip")).toBe(false);
    expect(isAllowedUpload("application/x-msdownload", "malware.exe")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/rag/upload-allowlist.test.ts`
Expected: FAIL — cannot find module `./upload-allowlist.js`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// backend/src/rag/upload-allowlist.ts
// The set of upload types the RAG ingest pipeline can read. Kept in its own
// module so the predicate is unit-testable without spinning up the route.
export const ALLOWED_MIME = new Set<string>([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // DOCX
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // XLSX
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // PPTX
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "text/html",
]);

// Browsers are unreliable about the MIME they attach to text-ish files
// (.md/.csv/.json often arrive as "" or application/octet-stream), so we also
// accept by extension. This mirrors the frontend's isFileTypeSupported.
export const ALLOWED_EXTENSIONS = new Set<string>([
  "pdf", "docx", "xlsx", "pptx",
  "png", "jpg", "jpeg", "webp",
  "txt", "md", "csv", "json", "html", "htm",
]);

export function isAllowedUpload(mimetype: string, filename: string): boolean {
  if (ALLOWED_MIME.has(mimetype)) return true;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return ALLOWED_EXTENSIONS.has(ext);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/rag/upload-allowlist.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/rag/upload-allowlist.ts backend/src/rag/upload-allowlist.test.ts
git commit -m "add upload allowlist module accepting office, image, and text types"
```

### Task 1.2: Backend — wire the allowlist into the upload route + fix tests

**Files:**
- Modify: `backend/src/rag/chat-routes.ts` (remove the local `ALLOWED_MIME` at 29-32; import + use `isAllowedUpload` in the guard at 364-367)
- Modify: `backend/src/rag/chat-routes.test.ts` (re-point the negative test; add an accept test)

**Interfaces:**
- Consumes: `isAllowedUpload` from Task 1.1.

- [ ] **Step 1: Update the route's negative test and add an accept test**

In `backend/src/rag/chat-routes.test.ts`, REPLACE the existing `it("rejects a non-PDF/DOCX file with 400", ...)` block (currently sends `text/plain`, which is now ALLOWED) with:

```ts
it("rejects a genuinely unsupported file with 400", async () => {
  dbMock.setResult([{ id: "c1" }]); // owned
  const res = await request(app())
    .post("/chat/conversations/c1/attachments")
    .attach("file", Buffer.from("PK fake zip"), {
      filename: "archive.zip",
      contentType: "application/zip",
    });
  expect(res.status).toBe(400);
});

it("accepts a newly-supported type (XLSX) and returns 202", async () => {
  dbMock.setResult([{ id: "att1" }]); // owned lookup + insert .returning row
  const res = await request(app())
    .post("/chat/conversations/c1/attachments")
    .attach("file", Buffer.from("PK fake xlsx"), {
      filename: "sheet.xlsx",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  expect(res.status).toBe(202);
  expect(res.body).toMatchObject({ status: "ready" });
});

it("accepts a .md sent as octet-stream via extension fallback", async () => {
  dbMock.setResult([{ id: "att2" }]);
  const res = await request(app())
    .post("/chat/conversations/c1/attachments")
    .attach("file", Buffer.from("# notes"), {
      filename: "notes.md",
      contentType: "application/octet-stream",
    });
  expect(res.status).toBe(202);
});
```

- [ ] **Step 2: Run the suite to verify the new accept tests fail**

Run: `cd backend && npx vitest run src/rag/chat-routes.test.ts`
Expected: FAIL — the XLSX/.md accept tests get 400 (route still uses the old 2-type `ALLOWED_MIME`).

- [ ] **Step 3: Wire `isAllowedUpload` into the route**

In `backend/src/rag/chat-routes.ts`:
- DELETE the local `ALLOWED_MIME` set (lines 29-32).
- Add the import near the other `./` imports:

```ts
import { isAllowedUpload } from "./upload-allowlist.js";
```

- Change the upload guard (currently lines 363-367) to:

```ts
const file = req.file;
if (!file || !isAllowedUpload(file.mimetype, file.originalname)) {
  res.status(400).json({ error: "Unsupported file type" });
  return;
}
```

(Leave `INLINE_SAFE_MIME` and the serve-file route untouched — that allowlist governs inline preview, not uploads.)

- [ ] **Step 4: Run the full backend suite to verify everything passes**

Run: `cd backend && npm test`
Expected: PASS — all existing tests plus the three new upload tests. (The serve-file XSS tests are unaffected because `INLINE_SAFE_MIME` is unchanged.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/rag/chat-routes.ts backend/src/rag/chat-routes.test.ts
git commit -m "accept the expanded upload types in the chat attachment route"
```

### Task 1.3: Frontend — widen the live accept-list

**Files:**
- Modify: `frontend/app/(main)/chat/components/chat-input.tsx` (the **canonical** one — imported by chat-composer/chat-input-wrapper/chat-widget-wrapper; NOT `app/(main)/components/chat-input.tsx`, which is dead)
- Modify: `frontend/app/(main)/chat/types.ts`

**Interfaces:**
- Produces: the UI now allows selecting/dropping the new types and shows a concise "Supports:" label. No test interface (frontend unit tests are disabled).

- [ ] **Step 1: Widen the inline accept-list trio (chat-input.tsx lines 74-82)**

Replace the comment + the three constants with:

```ts
// File types accepted by the RAG chat attachment upload endpoint.
const SUPPORTED_FILE_TYPES = ['PDF', 'DOCX', 'XLSX', 'PPTX', 'PNG', 'JPEG', 'WEBP', 'TXT', 'MD', 'CSV', 'JSON', 'HTML'];
const ACCEPTED_MIME_TYPES = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WEBP',
  'text/plain': 'TXT',
  'text/markdown': 'MD',
  'text/csv': 'CSV',
  'application/json': 'JSON',
  'text/html': 'HTML',
};
const ACCEPTED_EXTENSIONS = ['pdf', 'docx', 'xlsx', 'pptx', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'md', 'csv', 'json', 'html', 'htm'];
```

(`isFileTypeSupported` at lines 102-107 already checks `ACCEPTED_MIME_TYPES` then the extension fallback — it needs no change; it now covers the new types automatically.)

- [ ] **Step 2: Set a concise "Supports:" label (lines 1204 and 1614)**

A 12-item list reads poorly. Replace both `{`Supports: ${SUPPORTED_FILE_TYPES.join(', ')}.`}` occurrences with the same concise literal:

```tsx
{`Supports: PDF, Office (DOCX/XLSX/PPTX), images, and text files.`}
```

- [ ] **Step 3: Extend the `SupportedFileType` union and remove dead code (types.ts)**

- At `frontend/app/(main)/chat/types.ts:303`, extend the union to include the new labels:

```ts
export type SupportedFileType =
  | 'TXT' | 'PDF' | 'DOCX' | 'XLSX' | 'PPTX'
  | 'PNG' | 'JPEG' | 'JPG' | 'WEBP'
  | 'MD' | 'CSV' | 'JSON' | 'HTML';
```

- DELETE the dead `CHAT_ATTACHMENT_ACCEPTED_MIMETYPES` export (lines 315-320) — verified to have zero importers; it lists a stale/incorrect type set and only causes confusion.

- [ ] **Step 4: Typecheck (frontend has no unit tests)**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0, no errors. (If `SUPPORTED_FILE_TYPES` is typed as `SupportedFileType[]` somewhere, the extended union in Step 3 is what keeps it green.)

- [ ] **Step 5: Manual UI verification**

Run the dev server (`cd frontend && npm run dev`), open the chat composer. Expected: the "Supports:" line reads "Supports: PDF, Office (DOCX/XLSX/PPTX), images, and text files."; the file picker now lets you choose a `.xlsx`/`.pptx`/`.png`/`.txt`; selecting one shows a chip instead of an "unsupported" rejection.

- [ ] **Step 6: Commit**

```bash
git add "frontend/app/(main)/chat/components/chat-input.tsx" "frontend/app/(main)/chat/types.ts"
git commit -m "allow office, image, and text uploads in the chat composer"
```

### Task 1.4: Gotenberg — committable compose + VPS deploy brief

**Files:**
- Modify: `docker-compose.yml` (repo root)
- Create: `docs/vps-claude-gotenberg-deploy-brief.md`

**Interfaces:**
- Produces: a `gotenberg` service definition for local parity, and a VPS ops brief that is the load-bearing live change (executed on the server, not via this repo).

- [ ] **Step 1: Add the `gotenberg` service to the root compose (local parity)**

Under `services:` in `docker-compose.yml`, add (matching the file's existing indentation and `appnet` network usage):

```yaml
  gotenberg:
    image: gotenberg/gotenberg:8
    restart: unless-stopped
    networks:
      - appnet
    # No published ports — reached in-network at http://gotenberg:3000
    # (mirrors how the live stack keeps it internal, like qdrant).
```

- [ ] **Step 2: Validate the compose file**

Run: `docker compose -f docker-compose.yml config`
Expected: prints the merged config with the `gotenberg` service, no YAML/schema errors.

- [ ] **Step 3: Write the VPS deploy brief**

Create `docs/vps-claude-gotenberg-deploy-brief.md` following the existing `docs/vps-claude-*-brief.md` style. It MUST state:
- Target: `/opt/rag-skripsi-stack/docker-compose.yml` on the VPS (NOT the in-repo compose, NOT `docker-compose.vps.yml`).
- Add a `gotenberg` service: `image: gotenberg/gotenberg:8`, `restart: unless-stopped`, **no published ports**, on the stack's existing network (`rag-skripsi-stack_default` — match the `networks:` entry the `rag_n8n`/`qdrant` services use).
- Bring it up additively without disturbing anything else: `docker compose -f /opt/rag-skripsi-stack/docker-compose.yml up -d gotenberg`.
- Smoke test from a throwaway container on the stack network:

  ```bash
  docker run --rm --network rag-skripsi-stack_default curlimages/curl \
    -sS -o /tmp/out.pdf -F files=@/etc/hostname \
    http://gotenberg:3000/forms/libreoffice/convert ; echo $?
  ```
- Hard constraint reminder: do NOT touch/restart n8n, qdrant, postgres, or nginx; `gotenberg` is purely additive. STOP and report if anything else would change.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml docs/vps-claude-gotenberg-deploy-brief.md
git commit -m "add gotenberg service for office-to-pdf conversion and its vps deploy brief"
```

- [ ] **Step 5: Execute the live standup (user/ops step on the VPS)**

Per the brief, add `gotenberg` to `/opt/rag-skripsi-stack/docker-compose.yml` and run `docker compose up -d gotenberg`, then the smoke test. Confirm n8n can reach `http://gotenberg:3000`. (This is the same standup proven in Task 0.4; this step makes it the durable live state.)

### Task 1.5: n8n — build the shared "Read Document" sub-flow and wire it into `rag-ingest`

**Files:** none in repo. Built via the n8n MCP against workflow id `QwR8Ktmgu7h730ZQ`. Verified by execution. The deliverable is recorded in the spec's "As-built" notes and that doc edit is committed.

**Interfaces:**
- Consumes: the credential + request bodies proven in Tasks 0.2/0.3; the Gotenberg route + field name from Task 0.4; the fallback node names + downstream chunk/embed/upsert from Task 0.1.
- Produces: `rag-ingest` now reads all supported types into Markdown before the (unchanged) chunk→embed→upsert tail.

- [ ] **Step 1: Load SDK + node references via the MCP**

Call, in order: `get_sdk_reference`; `get_suggested_nodes` (categories: routing/branching, HTTP, file extraction); `search_nodes` for `["switch", "http request", "code", "extract from file", "compression"]`; then `get_node_types` for every node id you will use. Do not guess parameter names.

- [ ] **Step 2: Get the current `rag-ingest` graph**

Call `get_workflow_details` for `QwR8Ktmgu7h730ZQ`. Identify the node where the file binary enters (after the webhook) and the existing `extractFromFile` (PDF) and `docxLoader` (DOCX) nodes — the new sub-flow replaces the routing into them and reuses them as the fallback.

- [ ] **Step 3: Build the "Route by type" Switch**

Insert a **Switch** node keyed on the binary's mimeType/extension with these outputs:
- **pdf** → Gemini-read (Step 4)
- **image** (`image/png`, `image/jpeg`, `image/webp`) → Gemini-read (Step 4)
- **office** (`...wordprocessingml.document`, `...presentationml.presentation`) → Gotenberg (Step 5) → Gemini-read
- **xlsx** (`...spreadsheetml.sheet`) → XLSX dual-path (Step 6)
- **text** (`text/plain`, `text/markdown`, `text/csv`, `application/json`, `text/html`) → `Extract from File` (text) → straight to the chunk step (no Gemini)
- **fallback/default** → existing `extractFromFile`

- [ ] **Step 4: Build the Gemini-read node (HTTP Request)**

Recreate the proven node from Task 0.2: `POST .../models/gemini-2.5-flash:generateContent`, `Gemini API Key` credential, body with `inline_data` (base64 of the incoming binary) + the reader prompt. Add a **size guard**: if the binary exceeds the inline cutoff recorded in Task 0.3, route through the **Files API** two-step (Task 0.3) instead. Map the output to `candidates[0].content.parts[0].text` (a Set/Code node extracts it to a `text` field).

- [ ] **Step 5: Build the Gotenberg convert node (HTTP Request)**

`POST http://gotenberg:3000/forms/libreoffice/convert`, multipart, field `files` = the Office binary (preserve the original filename+extension so LibreOffice selects the right converter). Output is a PDF binary → feed into the Gemini-read node (Step 4).

- [ ] **Step 6: Build the XLSX dual-path**

For the xlsx branch: (a) `Extract from File` (xlsx) → cell text/CSV; (b) Gotenberg→PDF→Gemini-read (Steps 5+4) for charts/images. Merge both texts (a Code/Merge node concatenates: cell text first, then a `\n\n## Embedded figures\n` section with the Gemini output) into the single `text` field.

- [ ] **Step 7: Wire fallbacks**

On the Gemini-read node, set `Continue On Fail` (or an error branch): on error, route PDFs to the existing `extractFromFile`, Office to `docxLoader`/`Extract from File`, and images to a node that emits empty text (skip). Same for a Gotenberg failure → text-extract the original Office file. The flow must always reach the chunk step with at least some text (or empty for a text-less image) so ingest completes.

- [ ] **Step 8: Connect the unified `text` output to the existing chunk→embed→upsert tail**

All branches converge to the existing recursive splitter (800/100) → embed → Qdrant upsert (unchanged: same collection, `metadata.conversationId`, etc., per Task 0.1).

- [ ] **Step 9: Validate the workflow**

Call `validate_node_config` on each new node as you build, then `validate_workflow` on the whole graph. Fix all errors and re-validate until clean. Then `update_workflow` (id `QwR8Ktmgu7h730ZQ`) and `publish_workflow`.

- [ ] **Step 10: Record the as-built sub-flow in the spec and commit**

Append the final node layout (and any deviations) to the spec's "As-built notes".

```bash
git add docs/superpowers/specs/2026-06-27-gemini-document-ingest-design.md
git commit -m "record as-built read-document subflow wired into rag-ingest"
```

### Task 1.6: End-to-end integration verification

**Files:**
- Modify (record results): `docs/superpowers/specs/2026-06-27-gemini-document-ingest-design.md`

**Interfaces:**
- Consumes: the full Phase 1 stack (backend + frontend + Gotenberg + `rag-ingest`).
- Produces: a green run of the spec's fixture set; confirmation the success criteria hold.

- [ ] **Step 1: Run the fixture set through real uploads**

From the chat UI (or by POSTing to the live backend), upload and then ask an in-document question for each: pure-text PDF · scanned PDF · text+screenshot PDF (SISOP journal) · standalone PNG · DOCX with an embedded screenshot · PPTX image slides · wide XLSX with a chart · TXT · CSV · JSON. For each, confirm a grounded answer cites the document and the previously-invisible content (screenshot text, all XLSX columns + the chart) is now answerable.

- [ ] **Step 2: Failure drills**

Temporarily force a Gemini error (e.g. a bad model id in a copy of the node, or revoke the key briefly) → confirm ingest falls back to text extraction and still completes. Force a Gotenberg error (stop the container) → confirm Office files fall back to text extraction. Restore both.

- [ ] **Step 3: Confirm the existing path still works**

Re-run a plain PDF and a plain DOCX (the pre-existing supported types) → still ingest and answer correctly (no regression).

- [ ] **Step 4: Record results and commit**

Append a "Phase 1 verification (2026-06-27)" subsection to the spec listing each fixture and pass/fail.

```bash
git add docs/superpowers/specs/2026-06-27-gemini-document-ingest-design.md
git commit -m "record phase 1 integration verification results"
```

---

## Deferred to the Phase 2 plan (not in this plan)

Written separately after Phase 1 ships and the spike findings (esp. live embedding dimension + grounding citation shape) are recorded: the **Google Drive `RAG Library Sync`** workflow (Drive OAuth, Google-native export→PDF, edit-replace, `project_rag_library` collection) and the **RAG Query** changes (two-collection merge + answer generation on Gemini 2.5 Flash with Google Search grounding).
