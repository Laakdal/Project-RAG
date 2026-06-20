# Brief for the Claude running on the VPS

Paste everything in the code block below into the Claude Code session on the VPS.

```
TASK: Deploy the "Project RAG" backend + its Postgres into my EXISTING Dockerized stack
on this VPS, behind my EXISTING Dockerized nginx, served at https://api.ariorafa.site —
running ALONGSIDE the live n8n WITHOUT disrupting it. Only the backend + Postgres go here;
the frontend runs on a separate machine.

MY STACK: /opt/rag-skripsi-stack  — existing docker-compose.yml with n8n + a Dockerized
nginx + certbot (init-letsencrypt.sh). n8n is LIVE at n8n.ariorafa.site. DNS for
api.ariorafa.site already points to this VPS.

APP REPO: https://github.com/Laakdal/Project-RAG  branch dev2  (use this branch).
It contains backend/ (Express 5 + TS ESM + Postgres via pg/Drizzle + express-session
session auth + argon2; its own Dockerfile that runs `node dist/src/server.js` on port 4000),
plus REFERENCE files: docker-compose.vps.yml, .env.vps.example, deploy/nginx/api.ariorafa.site.conf,
docs/DEPLOY-VPS.md. NOTE: those reference files assume a HOST nginx — use them for the exact
service definitions/env/commands, but ADAPT to my Dockerized nginx (integrate, don't run a
second standalone stack).

STEPS:
1. Inspect my stack first and BACK UP before editing: `cat /opt/rag-skripsi-stack/docker-compose.yml`,
   the nginx config dir, and init-letsencrypt.sh. Learn the Docker network name, how nginx loads
   vhosts, the TLS cert path convention, and how n8n's vhost + cert are wired.
2. Clone the app: `git clone -b dev2 https://github.com/Laakdal/Project-RAG.git /opt/project-rag`
   (we only need backend/).
3. Add to my stack (so they share the nginx Docker network) — copy the shapes from the repo's
   docker-compose.vps.yml:
   - a `db` service (postgres:16-alpine, persistent named volume, healthcheck, NO published host port),
   - a `backend` service (build from /opt/project-rag/backend, NO published host port — nginx reaches it
     by container name), depends_on db healthy,
   - run DB migrations then seed the admin via one-shot containers of the backend image:
     `node dist/src/db/migrate.js`, then `node dist/scripts/create-admin.js`
     (the repo defines `migrate` and `seed-admin` services that do exactly this).
   Put db + backend on the SAME Docker network as nginx so nginx can `proxy_pass http://backend:4000`.
4. Backend env (CRITICAL — frontend is cross-site at http://localhost:3000):
     DATABASE_URL=postgres://<user>:<pass>@db:5432/<dbname>
     SESSION_SECRET=<openssl rand -hex 32>
     NODE_ENV=production
     PORT=4000
     COOKIE_SECURE=true
     COOKIE_SAMESITE=none        # backend refuses to start if samesite=none without secure=true
     CORS_ORIGIN=http://localhost:3000
     N8N_BASE_URL=https://n8n.ariorafa.site   # not used yet; for later RAG
   Keep secrets in a gitignored env file. ADMIN_EMAIL MUST be a real email with a TLD
   (e.g. admin@ariorafa.site) — the backend's validator rejects bare hosts like admin@local.
5. nginx: add a server block for api.ariorafa.site MIRRORING my n8n vhost (same cert mechanism),
   with `proxy_pass http://backend:4000;`, `proxy_set_header X-Forwarded-Proto $scheme;`
   (the backend uses this to mark cookies Secure), and SSE-friendly settings
   (`proxy_buffering off; proxy_read_timeout 300s;`). See deploy/nginx/api.ariorafa.site.conf
   for the location-block body, but use my cert paths + the dockerized service name (not 127.0.0.1).
6. TLS: add api.ariorafa.site to init-letsencrypt.sh (or however I issue certs), obtain the cert
   reusing my existing certbot, and reload nginx.
7. Bring it up WITHOUT recreating/breaking n8n; run migrate -> seed-admin -> backend; reload nginx.
   Verify: `docker compose ps` (backend healthy, n8n still up); `curl -s https://api.ariorafa.site/health`
   -> {"status":"ok"}; n8n.ariorafa.site still works.

GUARDRAILS:
- n8n is LIVE — do not disrupt it. Back up docker-compose.yml + nginx config before editing;
  validate with `docker compose config` and `nginx -t` (in the nginx container) before applying;
  reload (not restart) nginx where possible.
- No public host ports for db or backend — only nginx reaches the backend, only via the
  api.ariorafa.site vhost.
- Don't commit/push secrets.
When done, report: services added, the nginx vhost + cert result, and the
`curl https://api.ariorafa.site/health` output.
```
