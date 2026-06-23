# Brief for the VPS Claude — deploy the /chat backend update

Paste everything in the code block below into the Claude Code session on the VPS. It updates the
already-deployed (auth-only) backend to the new version that adds the RAG chat routes (`/chat/*`),
preserving existing users/sessions (the migration only ADDS three tables).

```
TASK: Update the already-deployed "Project RAG" backend on this VPS to the new version
that adds the RAG chat routes (/chat/*). The backend currently runs auth-only, integrated
into my dockerized stack at /opt/rag-skripsi-stack as the `rag_backend` service (built from
/opt/project-rag/backend, branch vps-backend). This is an UPDATE: preserve existing data
(the users table + sessions) — the new DB migration only ADDS three tables.

CONTEXT:
- App repo: /opt/project-rag (git branch vps-backend). The new backend code is already pushed.
- Stack: /opt/rag-skripsi-stack (Postgres + Qdrant + n8n + dockerized nginx + certbot). n8n is
  LIVE and the RAG workflows are already built and verified — do NOT touch n8n, postgres,
  qdrant, or nginx. Only rebuild/restart the `rag_backend` service.
- The backend is a thin proxy to n8n; it now needs N8N_BASE_URL in its env.

STEPS:
1. Pull the new code:
     cd /opt/project-rag && sudo git pull
2. Ensure the `rag_backend` service has N8N_BASE_URL set. Check the env it uses (the service's
   `environment:` in /opt/rag-skripsi-stack/docker-compose.yml, or the stack .env). If it is
   missing, add:
     N8N_BASE_URL=https://n8n.ariorafa.site
   (That public webhook base is verified-reachable; http://n8n:5678 also works since rag_backend
   shares n8n's Docker network. Back up any file before editing; do not commit secrets.)
3. Rebuild only the backend:
     cd /opt/rag-skripsi-stack
     docker compose build rag_backend
4. Apply the new DB migration (adds conversations/messages/attachments tables; existing tables
   untouched). One-off run, then it exits:
     docker compose run --rm --no-deps rag_backend node dist/src/db/migrate.js
   Expect "Migrations complete." with no error.
5. Restart the backend:
     docker compose up -d rag_backend
6. Verify (do NOT disrupt anything else):
     curl -s https://api.ariorafa.site/health            # -> {"status":"ok"}
     curl -s -i https://api.ariorafa.site/chat/conversations | head -1   # -> HTTP 401 (route mounted, auth active)
     docker compose ps                                   # rag_backend Up; n8n/postgres/qdrant/nginx unchanged

GUARDRAILS:
- Only `rag_backend` is rebuilt/restarted. n8n/postgres/qdrant/nginx must keep running.
- Back up any file you edit; validate with `docker compose config` before `up`.
- The migration only ADDS tables — no existing data is dropped.
- Don't modify the n8n workflows (they're built and live).

When done, report: the N8N_BASE_URL value used, the migration output, and the two curl results
(/health and /chat/conversations).
```

## Notes
- The migration (`node dist/src/db/migrate.js`) applies only NEW migrations — here just `0002`,
  which adds `conversations`, `messages`, `attachments`. Existing `users` + `user_sessions` are
  untouched.
- `N8N_BASE_URL` is the one genuinely new env requirement; without it the backend defaults to
  `localhost:5678` and cannot reach n8n.
- The n8n RAG workflows (RAG Ingest / RAG Query, Gemini + Qdrant `project_rag_chat`) are already
  built, published, and verified end-to-end — nothing to do there.
