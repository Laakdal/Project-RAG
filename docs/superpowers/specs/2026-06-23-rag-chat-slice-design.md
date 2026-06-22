# RAG Chat Slice 1 — Per-Chat Attachments (Design)

**Date:** 2026-06-23
**Status:** Approved design, ready for implementation plan
**Scope:** Slice 1 of the RAG product. Slice 2 (Google Drive shared library) is deferred and reuses this slice's embed/retrieve machinery.

---

## 1. Goal

Let a signed-in user drag a document into a chat, then ask questions and get an
answer grounded in that document, with a list of the source chunks used.

This single slice exercises the entire RAG loop end-to-end: upload → extract →
chunk → embed → store → retrieve → generate → cite. It is the smallest
self-contained vertical slice of the product.

**Success criteria:** From the chat UI, a user uploads a PDF, waits for
"indexing" to finish, asks a question whose answer is in the document, and
receives a correct answer plus a Sources list naming the document and the
relevant snippets. Answers a question whose content is NOT in the document with
"I don't find that in the provided document" (no hallucination).

---

## 2. Decisions

| Topic | Decision | Why |
|---|---|---|
| Ingestion model | **Per-chat attachment** (Model B) | Self-contained; the upload IS the ingestion. |
| Orchestration | **n8n owns the RAG**; backend is a thin authenticated proxy | Matches the project's n8n-centric design; visual, explainable pipeline for the thesis. |
| n8n exposure | **Private** on the Docker network (`http://n8n:5678`); reached only via the backend | Keeps auth in one place; n8n is never public. |
| Streaming | **Non-streaming** | n8n returns the full response; acceptable for a demo. Streaming can later move just the generation step into the backend. |
| Embeddings | **OpenAI `text-embedding-3-small`** (dim 1536) | Native n8n node; cheapest; simplest. |
| Vector store | **Qdrant** (existing `rag_qdrant`) | Already in the stack; native n8n node. |
| Generation | **Claude `claude-sonnet-4-6`** via n8n Anthropic node | Good grounded-answer quality at lower cost than Opus; model is a node setting, easy to change. |
| File types | **PDF + DOCX** for Slice 1 | Covers the common cases; XLSX is a follow-up. |
| Chat history | **Persisted in Postgres** (conversations, messages) | A chat product needs durable history; the backend already owns Postgres. |
| Citations | **Sources list** (filename + snippet) under the answer | Inline `[1]` markers are a later refinement. |

---

## 3. Architecture & data flow

The backend never performs AI work. It authenticates the session, forwards to
n8n over the private Docker network, and persists chat history.

```
Upload a file
  Frontend ──POST /chat/:id/attachments (backend, authed, multipart)──►
    n8n INGESTION webhook
      → Extract from File (PDF/DOCX)
      → chunk (~800 tokens, 100 overlap)
      → OpenAI embeddings
      → Qdrant upsert  payload {conversationId, filename, chunkIndex, text}
      → respond {status, chunkCount}

Ask a question
  Frontend ──POST /chat/:id/messages {question} (backend, authed)──►
    n8n QUERY webhook
      → OpenAI embed(question)
      → Qdrant search (filter conversationId, top-K=5)
      → build prompt (retrieved chunks + question)
      → Claude (claude-sonnet-4-6)
      → respond {answer, sources}
  Backend persists user message + assistant answer, returns {answer, sources}
```

---

## 4. Components

### A. n8n — Ingestion workflow
- **Webhook** (POST): receives the file (binary) + `conversationId`.
- **Extract from File**: PDF and DOCX → plain text.
- **Chunk**: ~800 tokens with ~100 token overlap (Code node or split node).
- **OpenAI Embeddings** node: embed each chunk.
- **Qdrant** node (upsert): vector + payload `{conversationId, filename, chunkIndex, text}`.
- **Respond to Webhook**: `{status: "ok", chunkCount}`.

### B. n8n — Query workflow
- **Webhook** (POST): receives `{conversationId, question}`.
- **OpenAI Embeddings**: embed the question.
- **Qdrant** node (search): filter `conversationId`, top-K = 5.
- **Build prompt** (Code/Set node): system instruction to answer ONLY from the
  provided context and say so when the answer is absent; context = retrieved chunks.
- **Anthropic Chat** node: `claude-sonnet-4-6`.
- **Respond to Webhook**: `{answer, sources: [{filename, chunkIndex, text}]}`.

### C. Backend — `/chat` routes
Session-authenticated (existing `requireAuth`) and CSRF-protected (existing
`requireCsrf`) on mutating routes. Thin proxy to n8n via `N8N_BASE_URL`.

- `POST /chat/conversations` → create a conversation, returns `{id}`.
- `GET  /chat/conversations` → list the user's conversations.
- `GET  /chat/conversations/:id/messages` → message history.
- `POST /chat/conversations/:id/attachments` (multipart) → validate type/size,
  forward to n8n ingestion webhook, record an `attachments` row, return status.
- `POST /chat/conversations/:id/messages` `{question}` → forward to n8n query
  webhook, persist user message + assistant answer (+ `sources`), return
  `{answer, sources}`.

Authorization: every route checks the conversation belongs to the session user.

### D. Frontend — chat view
Rewire the chat page off the dead `/api/v1` + SSE path to the new non-streaming
endpoints (new `lib/api` module; remove the streaming adapter for this view).
- Attach-file button → upload → show "indexing…" until the ingestion response.
- Send box → POST question → show a loading indicator → render the answer and a
  **Sources** list (filename + snippet) beneath it.
- Conversation list + history load from the GET endpoints.

---

## 5. Data model

### Qdrant
- Collection **`chat_attachments`**, vector size **1536**, distance Cosine.
- Payload: `{conversationId: string, filename: string, chunkIndex: int, text: string}`.
- Retrieval ALWAYS filters on `conversationId` so a chat sees only its own docs.

### Postgres (new Drizzle tables, provisioned by migration)
- `conversations` — `id uuid pk`, `user_id uuid fk→users`, `title text`, `created_at timestamptz`.
- `messages` — `id uuid pk`, `conversation_id uuid fk`, `role text` (`user`|`assistant`),
  `content text`, `sources jsonb null`, `created_at timestamptz`.
- `attachments` — `id uuid pk`, `conversation_id uuid fk`, `filename text`,
  `status text` (`indexing`|`ready`|`failed`), `created_at timestamptz`.

---

## 6. API contracts (backend ⇄ frontend)

```
POST /chat/conversations                  → 201 {id, title, createdAt}
GET  /chat/conversations                  → 200 [{id, title, createdAt}]
GET  /chat/conversations/:id/messages     → 200 [{id, role, content, sources, createdAt}]
POST /chat/conversations/:id/attachments  (multipart: file)
                                          → 202 {attachmentId, status, chunkCount}
POST /chat/conversations/:id/messages     {question}
                                          → 200 {answer, sources:[{filename, chunkIndex, text}]}
```

Backend ⇄ n8n (private):
```
POST {N8N_BASE_URL}/webhook/rag-ingest   {conversationId, filename} + binary file
                                          → {status, chunkCount}
POST {N8N_BASE_URL}/webhook/rag-query    {conversationId, question}
                                          → {answer, sources}
```

---

## 7. Error handling
- Unsupported file type or oversize upload → 400 before touching n8n.
- n8n unreachable / workflow error → 502 with a generic message; attachment row
  marked `failed`.
- Empty retrieval (no chunks for the conversation) → the query workflow still
  runs; the prompt instructs Claude to answer that no document context is available.
- All AI-provider keys (OpenAI, Anthropic) live in n8n credentials, never in the
  backend or the repo.

---

## 8. Out of scope for Slice 1 (YAGNI)
Token streaming · Google Drive / shared library (Slice 2) · XLSX · inline citation
markers · re-ranking · cross-conversation search · the 21-day archive cron ·
conversation titling/auto-summary.

---

## 9. Testing approach
- **n8n workflows:** exercised manually via the n8n editor with a sample PDF;
  verify Qdrant receives points and the query returns grounded answers.
- **Backend routes:** unit/integration tests for auth, ownership checks, input
  validation, and the n8n proxy (n8n mocked) — confirm persistence of messages.
- **End-to-end manual test (success criteria in §1):** upload a known PDF, ask an
  in-document question (correct answer + sources) and an out-of-document question
  (graceful "not found").

---

## 10. Open risks
- **n8n file/binary handling** through a webhook needs verification (multipart →
  Extract from File). If awkward, the backend may extract text and send text to
  n8n instead — decide during implementation.
- **Chunking quality** affects answer quality; start simple, tune top-K and chunk
  size against the manual test.
- **Qdrant filter syntax** in the n8n node for `conversationId` must be confirmed
  during the build.
