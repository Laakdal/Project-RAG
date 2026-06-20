# Full-Stack Docker Compose — Design Spec

**Date:** 2026-06-20
**Goal:** `docker compose up --build` from the repo root brings up Postgres + backend + frontend, runs DB migrations, seeds an admin, and serves a working login at `http://localhost:3000` against the backend at `http://localhost:4000`.

## Approach (approved)
- Production images (the existing `frontend/Dockerfile` + `backend/Dockerfile`), not dev hot-reload.
- Auto-seed an admin from `.env` on startup (idempotent upsert — `create-admin.ts` already supports `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`ADMIN_NAME`).

## New / changed files
1. **`docker-compose.yml` (repo root, new)** — orchestrates 5 services on the `appnet` network:
   - `db`: `postgres:16-alpine`, `pgdata` volume, healthcheck (reused from `backend/docker-compose.yml`).
   - `migrate` (one-shot): backend image, `node dist/src/db/migrate.js`, `depends_on db: service_healthy`, `restart: "no"`.
   - `seed-admin` (one-shot): backend image, `node dist/scripts/create-admin.js`, env `ADMIN_*`, `depends_on migrate: service_completed_successfully`, `restart: "no"`.
   - `backend`: backend image (the one service with `build: ./backend`, tagged `project-rag-backend:local`), `node dist/src/server.js`, port `4000`, `depends_on db healthy + migrate completed`.
   - `frontend`: `build: ./frontend` with args `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000`, `NEXT_PUBLIC_DEV_BYPASS_AUTH=0`, port `3000`, `depends_on backend: service_started`.
   - `migrate`/`seed-admin` reference `image: project-rag-backend:local` (no `build`); `--build` builds the `backend` service's image first so the tag exists.
2. **`.env.example` (repo root, new)** — documents `POSTGRES_USER/PASSWORD/DB`, `SESSION_SECRET`, `ADMIN_EMAIL/PASSWORD/NAME`.
3. **`.env` (repo root, new, gitignored)** — real dev values so `up` works out of the box.
4. **`backend/Dockerfile`** — fix `CMD` from `node dist/server.js` → `node dist/src/server.js` (tsc with `rootDir:"."` + `include scripts/**` emits under `dist/src/…` and `dist/scripts/…`; current path would fail to start).
5. **`backend/package.json`** — fix `start` script the same way (`node dist/src/server.js`).
6. **`.gitignore`** — ensure the root `.env` is ignored (add if missing).

## Environment wiring
- Backend env (inline `environment:` in compose, interpolated from root `.env`): `DATABASE_URL=postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}`, `SESSION_SECRET`, `NODE_ENV=production`, `PORT=4000`, `COOKIE_SECURE=false`, `COOKIE_SAMESITE=lax`, `CORS_ORIGIN=http://localhost:3000`. `migrate`/`seed-admin` get `DATABASE_URL` (and `seed-admin` also `ADMIN_*`).
- Backend↔db over the internal hostname `db`; browser↔backend over published `localhost:4000`; browser↔frontend over `localhost:3000`. Frontend↔backend are same-site (localhost), so the httpOnly `connect.sid` session cookie + CSRF double-submit work over plain http with `SameSite=lax`, `COOKIE_SECURE=false`.

## Why the dist paths resolve
`tsconfig` uses `rootDir: "."` and includes both `src/**` and `scripts/**`, so the compiled tree preserves `dist/src/…` and `dist/scripts/…`. `create-admin.js`'s `import "../src/db/index.js"` resolves correctly from `dist/scripts/`. Only the entry-point paths in the Dockerfile/`start` are wrong today; the relative imports are fine.

## Out of scope
Reverse-proxy single-origin, HTTPS/TLS, n8n/Qdrant, production secrets management, CI, dev hot-reload compose. The existing `frontend/docker-compose.yml` stays as the standalone no-backend preview.

## Verification
1. `cd backend && npm run build` then confirm `dist/src/server.js`, `dist/src/db/migrate.js`, `dist/scripts/create-admin.js` exist.
2. `docker compose config` parses cleanly.
3. `docker compose up --build`: `db` healthy → `migrate` exits 0 → `seed-admin` exits 0 → `backend` healthy on 4000, `frontend` on 3000.
4. Browser `http://localhost:3000`: log in with the seeded admin → `/chat`; refresh persists; logout → `/login` and a later `/auth/me` returns 401. (Satisfies the login-wiring Task 5 end-to-end, in Docker.)
