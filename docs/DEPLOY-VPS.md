# Deploy: backend + Postgres on the VPS, frontend local

**Topology**
```
Browser (your PC) ─▶ frontend  http://localhost:3000        (local: npm run dev or Docker)
        └────────▶ backend   https://api.ariorafa.site  ─nginx─▶ 127.0.0.1:4000 (VPS Docker)
Backend (VPS) ─▶ Postgres (private)   ·   n8n at n8n.ariorafa.site (wired later for RAG)
```

The frontend and backend are on **different sites** (`localhost` vs `api.ariorafa.site`),
so the backend uses `COOKIE_SAMESITE=none` + `COOKIE_SECURE=true`, and the frontend sends
the CSRF token from the `/auth/csrf` response body (a `localhost` page can't read an
`api.ariorafa.site` cookie).

## Prerequisites
- `api.ariorafa.site` A record → VPS IP ✅ (done)
- nginx + certbot on the VPS (already used for n8n)
- Repo present on the VPS (`git clone` / `git pull`)

## 1. Env (on the VPS)
```bash
cd /path/to/Project-RAG
cp .env.vps.example .env.vps
# Edit .env.vps: SESSION_SECRET (openssl rand -hex 32), POSTGRES_PASSWORD,
# ADMIN_EMAIL, ADMIN_PASSWORD.
```

## 2. Start backend + Postgres (on the VPS)
```bash
docker compose -f docker-compose.vps.yml --env-file .env.vps up -d --build
docker compose -f docker-compose.vps.yml --env-file .env.vps ps     # backend healthy; migrate/seed-admin Exited (0)
curl -s http://127.0.0.1:4000/health                                # {"status":"ok"}
```
Migrations run and the admin is seeded automatically.

## 3. nginx + HTTPS (on the VPS)
```bash
sudo cp deploy/nginx/api.ariorafa.site.conf /etc/nginx/sites-available/api.ariorafa.site
sudo ln -s /etc/nginx/sites-available/api.ariorafa.site /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.ariorafa.site        # issues cert + rewrites vhost to 443
curl -s https://api.ariorafa.site/health         # {"status":"ok"} over HTTPS
```

## 4. Point the local frontend at the VPS (on your PC)
`frontend/.env.local`:
```
NEXT_PUBLIC_API_BASE_URL=https://api.ariorafa.site
NEXT_PUBLIC_DEV_BYPASS_AUTH=0
```
Run it:
```bash
cd frontend && npm run dev          # http://localhost:3000  (hot reload)
# or Docker: docker compose -f docker-compose.frontend.yml up -d --build
```

## 5. Test
Open http://localhost:3000 → log in with your `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
In DevTools → Network: calls go to `https://api.ariorafa.site`, `/auth/login` returns
200, a `connect.sid` cookie is set, and you land in `/chat`.

**If login fails with 403/401 and no cookie is stored:** your browser is blocking the
cross-site (third-party) cookie. Either allow third-party cookies for `localhost`, or
switch to the same-origin-proxy fallback (a small `next.config` rewrite so the browser
only ever talks to `localhost`) — ask and I'll wire it.

## Later: backend → n8n privately (optional optimization)
The backend will call n8n at `N8N_BASE_URL` (public URL by default). To keep RAG traffic
private once the workflow exists:
1. `docker network ls` → find n8n's network (e.g. `n8n_default`).
2. Add it as an `external` network on the `backend` service in `docker-compose.vps.yml`.
3. Set `N8N_BASE_URL=http://n8n:5678` in `.env.vps`; recreate the backend.

> There is no n8n workflow to call yet — this only co-locates the backend with n8n and
> pre-wires the URL. Building the RAG query/ingestion workflows is the next phase.
