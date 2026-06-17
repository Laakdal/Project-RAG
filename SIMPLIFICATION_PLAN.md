# Project-RAG — Build Plan

A simplified, internal **RAG application**: ChatGPT/Claude-style chat over your company's
documents, built on the PipesHub frontend with **n8n** as the backend/orchestration layer.

> Status: architecture + scope locked. Ready to start Phase 1.
> Frontend already runs with no backend (lands on `/login`) and is Dockerized.

---

## 1. Product vision

An internal company tool where employees ask questions and get answers grounded in company
documents — like ChatGPT/Claude, but over *your* data. Documents get in **two ways**:

- **Shared library (Model A)** — auto-fed from **Google Drive**. Company docs flow in; everyone
  can query them. No manual upload needed for these.
- **Per-chat attachments (Model B)** — the ChatGPT/Claude UX: start a chat, drag a file in, ask
  about it. Scoped to that conversation.

Internal use only: **admin creates accounts**, users just log in (no sign-up / reset / forgot).

---

## 2. Target architecture

```
Next.js frontend (simplified)
        │  (webhooks / REST)
        ▼
      n8n  ── orchestration: RAG query, ingestion, daily cleanup cron
        ├─ Postgres (app)    → users/auth, document metadata, chat history, last_used_at
        ├─ Postgres (files)  → raw document blobs (PDF/DOCX/XLSX as BYTEA)
        └─ Qdrant            → vector embeddings (retrieval)
```

**Decisions made:**

| Topic | Decision | Why |
|---|---|---|
| Backend / orchestration | **n8n** | one engine for RAG, ingestion, integrations, cron |
| Vectors | **Qdrant** | purpose-built vector search |
| Relational data | **Postgres** | n8n itself runs on Postgres → one DB technology |
| Raw files | **Postgres (BYTEA)**, separate DB | files are small (PDF/DOCX/XLSX, no video); 21-day cleanup keeps it bounded → no MinIO needed |
| Google Drive | **n8n Google Drive node** (admin connects one company Drive) | avoids the heavy PipesHub connector backend |
| File types | PDF, Word, Excel | text extracted in n8n before embedding |
| Auth | **admin-created accounts**, password login only | internal tool |
| Retention | **archive** docs after 21 days unused (n8n cron) | safer than hard-delete; nothing truly lost |
| Persistence | Postgres + Qdrant on **persistent Docker volumes** | survives restarts/updates |

*All of these are reversible — e.g. swap file storage to MinIO later if volume grows.*

---

## 3. Scope — keep / drop

### ✅ Keep
| Area | Route | Role in the app |
|---|---|---|
| Chat | `/chat` | ChatGPT/Claude-style RAG chat + per-chat file attach + streaming |
| Collections / Knowledge Base | `/knowledge-base` | the shared library (fed from Google Drive) |
| Record viewer | `/record` | open a source document / citation target |
| Login | `/login` | password only, admin-created accounts |
| Admin: users | `/workspace/users` | admin creates/manages employee accounts |
| Admin: general, profile | `/workspace/general`, `/workspace/profile` | minimal org + user settings |

### ❌ Drop
- **AI extras:** `/agents`, `/toolsets`
- **Connectors UI:** `/connectors` — Google Drive handled in n8n instead
- **Auth flows:** `/sign-up`, `/reset-password`, forgot-password
- **Workspace/admin:** `ai-models`, `prompts`, `web-search`, `services`, `bots`, `mail`,
  `developer-settings`, `groups`, `actions`, `archived-chats`, `labs`, workspace `authentication`,
  workspace `connectors`
- **Platform infra:** electron desktop shell, onboarding wizard + surveys + tours,
  WebSocket notifications, multi-language i18n (keep English only)

### 🕒 Deferred (add later if needed)
- `/workspace/teams` (RBAC) — keep `users` for now; add teams when there's a real need.

---

## 4. How the two document paths work

**Library docs (Google Drive):**
```
n8n Drive node (scheduled) → fetch new/changed files → extract text → embed → Qdrant
                                                      → metadata row → Postgres (app)
                                                      → (optional) cache blob → Postgres (files)
```

**Per-chat attachments:**
```
User drags file in chat → frontend uploads → n8n → store blob (Postgres files)
                                                  → extract text → embed → Qdrant (scoped to conversation)
                                                  → metadata → Postgres (app)
```

**Asking a question:**
```
frontend → n8n webhook → embed question → Qdrant search (library + this chat's docs)
                       → build prompt with retrieved chunks → LLM → stream answer + citations → frontend
```

---

## 5. Build phases

Each phase ends with "app still boots / works" before the next. All on a **new git branch**.

- **Phase 0 — Branch.** Create `simplify` branch; commit current state.
- **Phase 1 — Strip cruft (no behavior change to what remains).** Remove electron, extra
  languages, onboarding/surveys/tours, notifications, dropped workspace pages, agents/toolsets,
  connectors UI, sign-up/reset. Fix sidebar/nav. Verify it still boots to `/login`.
- **Phase 2 — Rewire to n8n + Postgres auth.** Point the API layer at n8n webhooks; implement
  admin-created-account login against the Postgres `users` table.
- **Phase 3 — Wire the kept features.** Chat (stream from n8n), per-chat attachments, Collections
  (Drive-fed library), record viewer.
- **Phase 4 — n8n workflows.** Google Drive ingestion, upload-and-embed, RAG query, 21-day
  archive cron.
- **Phase 5 — Full stack compose.** `docker-compose.yml` for frontend + n8n + Postgres + Qdrant
  with persistent volumes.

---

## Appendix — already done

- ✅ Frontend copied into `frontend/`; runs with no backend (degrades to `/login`).
- ✅ `frontend/.env.local` sets `NEXT_PUBLIC_API_BASE_URL`.
- ✅ Dockerized frontend: `Dockerfile`, `.dockerignore`, `docker-compose.yml`
  (standalone Next.js server; `docker compose up --build` → http://localhost:3000).
- ✅ `next.config.mjs` has opt-in `output: 'standalone'` (`NEXT_OUTPUT_STANDALONE=1`).

### Open defaults (flip any if you disagree)
- Google Drive = one admin-connected company Drive (not per-user OAuth).
- Retention = archive (not hard-delete) after 21 days unused.
- `teams` deferred; `users` kept.
