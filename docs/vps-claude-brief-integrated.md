# Brief for the Claude running on the VPS (integrated dockerized-nginx deploy)

Paste everything in the code block below into the Claude Code session on the VPS.
The detailed, step-by-step runbook it refers to lives in this repo at
`docs/DEPLOY-VPS-INTEGRATED.md` (on branch `vps-backend`).

```
TASK: Deploy the Project RAG backend into my existing dockerized stack, following the
runbook in the repo. Do NOT improvise the architecture — the runbook is the source of truth.

1. Clone: sudo git clone -b vps-backend https://github.com/Laakdal/Project-RAG.git /opt/project-rag
2. Read and follow: /opt/project-rag/docs/DEPLOY-VPS-INTEGRATED.md
   It integrates a `rag_backend` service into my live stack at /opt/rag-skripsi-stack,
   reuses rag_postgres (new DB `project_rag`), and serves https://api.ariorafa.site behind
   my dockerized nginx (rag_nginx) + webroot certbot.

GUARDRAILS (critical — n8n is LIVE):
- Back up docker-compose.yml before editing; ONLY ADD the rag_backend service, never modify
  postgres/qdrant/n8n/nginx/certbot.
- Before the nginx step, `cat /opt/rag-skripsi-stack/nginx/conf.d/*.conf` and make the new
  api.ariorafa.site vhost match my existing n8n vhost's cert paths/conventions.
- Validate with `docker compose config` and `docker exec rag_nginx nginx -t` before applying;
  reload (not restart) nginx.
- Set a real RAG_ADMIN_PASSWORD in .env; don't commit/push secrets.
- Stop and ask me before anything that could disrupt n8n.

When done, report: services added, the nginx vhost + cert result, `docker compose ps`,
and the output of `curl -s https://api.ariorafa.site/health`.
```

## Decisions baked into the runbook (override only if I tell you to)
- **Reuse `rag_postgres`** for the backend with a separate database `project_rag` — do NOT
  spin up a second Postgres container. n8n's database stays untouched.
- **Integrate into the existing `/opt/rag-skripsi-stack/docker-compose.yml`** (one compose
  project, shared `rag_internal_network`) — do NOT run a second standalone stack.
- **No published host ports** for the backend — only `rag_nginx` reaches it, only via the
  `api.ariorafa.site` vhost.
