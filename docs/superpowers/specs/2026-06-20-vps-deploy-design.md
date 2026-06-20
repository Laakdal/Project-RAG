# VPS Deploy (backend + Postgres) with Local Frontend — Design

**Date:** 2026-06-20

## Goal
Run the backend + Postgres on the Ubuntu VPS (alongside the existing n8n), behind nginx at
`https://api.ariorafa.site`, with the Next.js frontend running on the developer's local
machine pointed at that API. Establishes the foundation for the eventual n8n-backed RAG;
**building the RAG workflows is out of scope here.**

## Topology
```
Browser (local) → frontend localhost:3000 → API https://api.ariorafa.site → nginx → backend:4000 (VPS)
backend → Postgres (VPS, private)   ·   N8N_BASE_URL (n8n.ariorafa.site, used later)
```

## Decisions
- **Subdomain (`api.ariorafa.site`)** over SSH tunnel — user wants a public API endpoint; DNS record created.
- **Cross-site cookies (approach A):** backend `COOKIE_SAMESITE=none` + `COOKIE_SECURE=true`; `CORS_ORIGIN=http://localhost:3000`. Frontend sends the CSRF token from the `/auth/csrf` response body (a `localhost` page cannot read an `api.ariorafa.site` cookie). Same-origin-proxy is the documented fallback if a browser blocks the third-party cookie.
- **Postgres stays private** (no published port); backend bound to `127.0.0.1:4000` so only nginx reaches it.
- **backend → n8n** via public `N8N_BASE_URL` by default; internal Docker-network join documented as a later optimization. No n8n call exists yet.

## Artifacts
- `docker-compose.vps.yml` — db + backend + migrate + seed-admin (no frontend), cross-site env.
- `.env.vps.example` — secrets/config template for the VPS.
- `deploy/nginx/api.ariorafa.site.conf` — nginx vhost (certbot upgrades to 443).
- `docker-compose.frontend.yml` — optional local frontend-only image.
- `frontend/app/(public)/api.ts` — CSRF token sent from response body (cross-site safe).
- `frontend/.env.local` — `NEXT_PUBLIC_API_BASE_URL=https://api.ariorafa.site`.
- `docs/DEPLOY-VPS.md` — the runbook.

## Verification
`https://api.ariorafa.site/health` returns ok over TLS; local frontend login with the seeded
admin reaches the VPS, sets `connect.sid`, lands in `/chat`; refresh persists; logout 401s `/auth/me`.

## Out of scope
The n8n RAG workflows (query, Google Drive ingestion, cron) and wiring the chat path through
backend→n8n — still pending the embeddings/LLM/Qdrant decisions.
