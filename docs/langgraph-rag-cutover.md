# LangGraph RAG Cutover Guide

This document covers the steps to switch the RAG backend from n8n to the new
LangGraph/LangChain implementation, and how to roll back if needed.

## Prerequisites

Before proceeding, complete the **Live smoke test** section below. Do not flip
`RAG_PROVIDER` in production until the smoke test passes with your real credentials.

---

## Environment keys

All keys required for `RAG_PROVIDER=langgraph` are in `backend/.env.example`.
Copy the relevant block into your `.env` (or the VPS environment file):

```
RAG_PROVIDER=langgraph
QDRANT_URL=http://localhost:6333          # or your remote Qdrant address
QDRANT_COLLECTION_LG=project_rag_chat_lg  # do NOT reuse project_rag_chat_oai
OPENAI_API_KEY=sk-...
OPENROUTER_API_KEY=sk-or-...
GOTENBERG_URL=http://localhost:3001        # required for DOCX ingest only
```

Model defaults (change only if you know what you are doing):

```
GEMINI_READ_MODEL=google/gemini-2.5-flash   # document reading via OpenRouter
EMBED_MODEL=text-embedding-3-small           # 1536-D OpenAI embeddings
GENERATE_MODEL=gpt-4o-mini                   # answer generation (Responses API)
```

---

## Qdrant collection

The LangGraph path uses a **separate** Qdrant collection (`project_rag_chat_lg`,
1536-D Cosine) so it never conflicts with the n8n collection (`project_rag_chat_oai`).

The collection is created automatically on the first `addDocuments` call by
`@langchain/qdrant`. If your Qdrant version does not auto-create, run once:

```bash
curl -X PUT "${QDRANT_URL}/collections/project_rag_chat_lg" \
  -H "Content-Type: application/json" \
  -d '{
    "vectors": {
      "size": 1536,
      "distance": "Cosine"
    }
  }'
```

---

## Live smoke test (run before cutover — user-run prerequisite)

**This section must be completed by the operator against real services before
setting `RAG_PROVIDER=langgraph` in production. It is NOT automated.**

1. Set `RAG_PROVIDER=langgraph` plus all required keys in your local `.env`.
2. Start the backend: `cd backend && npm run dev`
3. Upload a small PDF to any conversation via the chat UI (or `curl`/Postman):
   - Expect: HTTP 202 with `chunkCount > 0` in the response body.
4. Ask a question whose answer is clearly in the uploaded PDF:
   - Expect: `answer` contains a relevant response; `sources` is non-empty and
     `filename` matches the uploaded file.
5. Ask an off-document question (something not in the PDF, e.g. current news):
   - Expect: `answer` is plausible; `sources` is `[]` (web-search fallback path).
6. If any step fails, investigate with `RAG_PROVIDER=n8n` still set (no user impact)
   and fix before proceeding to the cutover steps below.

---

## Cutover checklist

Perform these steps in order once the smoke test is green.

- [ ] **1. Set `RAG_PROVIDER=langgraph`** in the target environment (VPS `.env` or
  secrets manager). Restart the backend.

- [ ] **2. Re-ingest existing attachments.** The LangGraph path writes to
  `project_rag_chat_lg`, which is a different Qdrant collection from the n8n
  path's `project_rag_chat_oai`. Documents ingested before cutover are NOT
  visible to the new path until they are re-ingested. Ask users to re-upload
  any files they need to query, or run a batch re-ingest script.

- [ ] **3. Monitor for errors.** Watch the backend logs for `requireLanggraphEnv`
  failures (missing env key) or Qdrant/OpenAI errors. Check the chat UI works
  end-to-end for both ingest and query.

- [ ] **4. Rollback if needed.** Set `RAG_PROVIDER=n8n` and restart. The n8n path
  is unchanged; all previously ingested n8n data is still in
  `project_rag_chat_oai` and will be queried as before.

- [ ] **5. After a stable burn-in, plan cleanup** (separate change, not part of
  Phase 1): delete the `n8nProvider` wiring in `provider.ts`, archive the n8n
  workflows, and remove the `n8n-client.ts` import chain.
