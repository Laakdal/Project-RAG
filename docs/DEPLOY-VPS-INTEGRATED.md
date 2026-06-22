# Deploy backend into the existing dockerized stack (`/opt/rag-skripsi-stack`)

Integrates the Project RAG **backend** into your live n8n stack, behind the **same dockerized
nginx**, served at `https://api.ariorafa.site`. It **reuses your existing `rag_postgres`**
(a new database `project_rag`; n8n's DB is untouched) and joins `rag_internal_network`.
We only **add** services — n8n / qdrant / postgres / nginx are never modified.

> Run everything on the VPS. Targets specific services by name so nothing else is recreated.

```
Browser (your PC) ─▶ frontend  http://localhost:3000        (runs locally, NOT on the VPS)
        └────────▶ https://api.ariorafa.site ─[rag_nginx]─▶ rag_backend:4000
                                                            └▶ rag_postgres (db: project_rag)
```

---

## 0. Prerequisites
- `api.ariorafa.site` A record → this VPS (done).
- The stack is up (`docker compose ps` shows `rag_nginx`, `rag_postgres`, `rag_n8n` running).
- You already ran `cp docker-compose.yml docker-compose.yml.bak`.

## 1. Clone the backend repo (backend-only branch)
```bash
sudo git clone -b vps-backend https://github.com/Laakdal/Project-RAG.git /opt/project-rag
```

## 2. Create the backend's database in the existing Postgres
A separate DB inside the same engine — n8n's DB is left alone.
```bash
cd /opt/rag-skripsi-stack
set -a; . ./.env; set +a            # load POSTGRES_USER / POSTGRES_PASSWORD
docker exec rag_postgres psql -U "$POSTGRES_USER" -c "CREATE DATABASE project_rag;"
# "already exists" on a re-run is fine — ignore it.
```

## 3. Add backend env vars to the stack `.env`
Append to `/opt/rag-skripsi-stack/.env` (gitignored). `RAG_` prefix avoids clashing with n8n's vars.
```bash
cat >> /opt/rag-skripsi-stack/.env <<EOF

# --- Project RAG backend ---
RAG_SESSION_SECRET=$(openssl rand -hex 32)
RAG_CORS_ORIGIN=http://localhost:3000
RAG_ADMIN_EMAIL=admin@ariorafa.site
RAG_ADMIN_PASSWORD=change-me-to-a-strong-password
RAG_ADMIN_NAME=Admin
EOF
```
Then edit the file and set a real `RAG_ADMIN_PASSWORD`. `RAG_ADMIN_EMAIL` **must have a TLD**
(the backend's validator rejects bare hosts like `admin@local`).

## 4. Add the backend service to `docker-compose.yml`
Paste this block under `services:` in `/opt/rag-skripsi-stack/docker-compose.yml`
(indentation matters — two spaces, same level as `postgres:`):

```yaml
  # --- Project RAG backend (added; existing services untouched) ---
  rag_backend:
    build:
      context: /opt/project-rag/backend
      dockerfile: Dockerfile
    image: project-rag-backend:local
    container_name: rag_backend
    restart: unless-stopped
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/project_rag
      SESSION_SECRET: ${RAG_SESSION_SECRET}
      NODE_ENV: production
      PORT: "4000"
      # Frontend is cross-site (localhost) → cookies must be SameSite=None + Secure.
      COOKIE_SECURE: "true"
      COOKIE_SAMESITE: none
      CORS_ORIGIN: ${RAG_CORS_ORIGIN}
      # Used later for RAG; harmless now.
      N8N_BASE_URL: https://${DOMAIN}
      # Read only by the one-off seed command (step 6); ignored by the server.
      ADMIN_EMAIL: ${RAG_ADMIN_EMAIL}
      ADMIN_PASSWORD: ${RAG_ADMIN_PASSWORD}
      ADMIN_NAME: ${RAG_ADMIN_NAME}
    # No host port — only nginx (same network) reaches it.
    expose:
      - "4000"
    depends_on:
      - postgres
    networks:
      - rag_internal_network
```

Validate the file parses (does not start anything):
```bash
docker compose config >/dev/null && echo "compose OK"
```

## 5. Build the image
```bash
docker compose build rag_backend
```

## 6. Migrate, then seed the admin (one-off runs, auto-removed)
Postgres is already up, so we run these explicitly in order. `--no-deps` keeps them from
touching other services.
```bash
docker compose run --rm --no-deps rag_backend node dist/src/db/migrate.js
docker compose run --rm --no-deps rag_backend node dist/scripts/create-admin.js
```
Expect the migrate run to report applied migrations, and the seed run to confirm the admin
was created/updated. Both should exit 0.

## 7. Start the backend
```bash
docker compose up -d rag_backend
docker compose ps                       # rag_backend Up; n8n/postgres/qdrant/nginx unchanged
docker compose logs --tail=30 rag_backend   # "Server listening on port 4000"
```
Quick internal check (no nginx yet):
```bash
docker compose exec rag_backend node -e "fetch('http://127.0.0.1:4000/health').then(r=>r.text()).then(t=>{console.log(t);process.exit(0)})"
# → {"status":"ok"}
```

## 8. nginx vhost — bootstrap (HTTP only, for the cert challenge)
> CROSS-CHECK against your n8n vhost first so paths/conventions match:
> `cat /opt/rag-skripsi-stack/nginx/conf.d/*.conf`

Create `/opt/rag-skripsi-stack/nginx/conf.d/api.ariorafa.site.conf` with **only** the HTTP block
(can't reference a TLS cert that doesn't exist yet, or nginx fails to reload and that would
affect n8n too):
```nginx
server {
    listen 80;
    listen [::]:80;
    server_name api.ariorafa.site;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 404;
    }
}
```
Test and reload the dockerized nginx:
```bash
docker exec rag_nginx nginx -t && docker exec rag_nginx nginx -s reload
```

## 9. Issue the TLS cert (HTTP-01 webroot, via your certbot container)
```bash
docker compose run --rm --entrypoint certbot certbot \
  certonly --webroot -w /var/www/certbot \
  -d api.ariorafa.site \
  --email you@ariorafa.site --agree-tos --no-eff-email
```
Success drops the cert at `/etc/letsencrypt/live/api.ariorafa.site/` (shared with nginx via the
`certbot_certs` volume).

## 10. nginx vhost — final (add the HTTPS block)
Replace the file from step 8 with the full version:
```nginx
server {
    listen 80;
    listen [::]:80;
    server_name api.ariorafa.site;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name api.ariorafa.site;

    ssl_certificate     /etc/letsencrypt/live/api.ariorafa.site/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.ariorafa.site/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers off;

    location / {
        proxy_pass http://rag_backend:4000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        # Backend trusts this to mark cookies Secure (app.set('trust proxy', 1)).
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE-friendly (future chat streaming).
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_read_timeout 300s;
    }
}
```
Test and reload:
```bash
docker exec rag_nginx nginx -t && docker exec rag_nginx nginx -s reload
```

## 11. Verify (and confirm n8n is unaffected)
```bash
curl -s https://api.ariorafa.site/health      # {"status":"ok"}
curl -sI https://n8n.ariorafa.site | head -1  # still 200/302 — n8n untouched
docker compose ps                             # rag_backend Up; everything else Up
```

## 12. Point the local frontend at the VPS (on your PC, NOT the VPS)
`frontend/.env.local`:
```
NEXT_PUBLIC_API_BASE_URL=https://api.ariorafa.site
NEXT_PUBLIC_DEV_BYPASS_AUTH=0
```
Run `npm run dev`, open http://localhost:3000, log in with `RAG_ADMIN_EMAIL` / `RAG_ADMIN_PASSWORD`.
In DevTools → Network, `/auth/login` returns 200 and sets a `connect.sid` cookie.

> If login fails with no cookie stored, your browser is blocking the cross-site cookie. Allow
> third-party cookies for `localhost`, or switch to a same-origin proxy (a `next.config` rewrite) —
> ask and I'll wire it.

---

## Rollback (if anything looks wrong)
```bash
docker compose rm -sf rag_backend                       # stop/remove just the backend
# remove the rag_backend block from docker-compose.yml (or: cp docker-compose.yml.bak docker-compose.yml)
rm /opt/rag-skripsi-stack/nginx/conf.d/api.ariorafa.site.conf
docker exec rag_nginx nginx -t && docker exec rag_nginx nginx -s reload
# optional: drop the DB
docker exec rag_postgres psql -U "$POSTGRES_USER" -c "DROP DATABASE project_rag;"
```
n8n, qdrant, postgres, and nginx are never edited by this procedure — only added to.

## Notes
- `proxy_pass http://rag_backend:4000` resolves because nginx and `rag_backend` share
  `rag_internal_network` in the same compose project.
- Re-deploy after a code change: `cd /opt/project-rag && sudo git pull`, then
  `cd /opt/rag-skripsi-stack && docker compose build rag_backend && docker compose up -d rag_backend`
  (re-run step 6 migrate if the schema changed).
