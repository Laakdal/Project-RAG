# Brief for the VPS Claude — deploy the admin Library feature

Adds the admin **Library** routes (`GET /library/status`, `POST /library/sync`) to the
already-deployed `rag_backend`. The frontend Library page currently shows
**"Failed to load library status — Not found"** because the live backend has no `/library`
router — this deploy adds it.

Do this in **two parts**:

- **Part A** makes the page load (status endpoint + new table). Needs **no** new secrets or
  services. Do this now — it fixes the visible error.
- **Part B** makes the **Sync library** button actually index Drive into Qdrant. It needs
  Google Drive credentials, a model API key, and a new Gotenberg service. Do this only when
  you have those secrets (see "Part B inputs required" below).

The DB migration (`0007_bouncy_speed`) only **ADDS** the `library_documents` table — existing
data (users, conversations, messages, attachments, sessions) is untouched.

---

## Part A — fix the page (no new env, no new services)

Paste into the Claude Code session on the VPS:

```
TASK: Update the already-deployed "Project RAG" backend to add the admin Library routes
(/library/status, /library/sync). The backend runs integrated in my dockerized stack at
/opt/rag-skripsi-stack as the `rag_backend` service (built from /opt/project-rag/backend,
branch vps-backend). This is an UPDATE: the new DB migration only ADDS one table
(library_documents) — preserve all existing data. Do NOT touch n8n, postgres, qdrant, or nginx;
only rebuild/restart `rag_backend`.

STEPS:
1. Pull the new code:
     cd /opt/project-rag && sudo git pull
2. Rebuild only the backend:
     cd /opt/rag-skripsi-stack
     docker compose build rag_backend
3. Apply the new migration (adds the library_documents table; existing tables untouched).
   One-off run, then it exits:
     docker compose run --rm --no-deps rag_backend node dist/src/db/migrate.js
   Expect "Migrations complete." with no error.
4. Restart the backend:
     docker compose up -d rag_backend
5. Verify (do NOT disrupt anything else):
     curl -s https://api.ariorafa.site/health                              # -> {"status":"ok"}
     curl -s -i https://api.ariorafa.site/library/status | head -1         # -> HTTP 401 (route now mounted, auth active)
     docker compose ps                                                     # rag_backend Up; n8n/postgres/qdrant/nginx unchanged

GUARDRAILS:
- Only `rag_backend` is rebuilt/restarted. n8n/postgres/qdrant/nginx must keep running.
- The migration only ADDS a table — no existing data is dropped.
- Back up any file you edit; validate with `docker compose config` before `up`.

When done, report: the migration output and the two curl results (/health and /library/status).
The key success signal is that /library/status returns 401 (route mounted) instead of 404.
```

After Part A: the Library admin page loads and shows **0 documents** (empty index). The
"Sync library" button will return an error until Part B is done.

---

## Part B — enable "Sync library" (needs secrets + a Gotenberg service)

`runSync()` lists a shared Google Drive folder, reads each file (Gemini over OpenRouter; Office
files are converted to PDF by Gotenberg first), embeds the text (OpenAI embeddings), and upserts
into the Qdrant collection `project_rag_library`. So it needs Drive creds, a Gotenberg service,
and model API keys.

### Part B inputs required (you must supply these)
- **`DRIVE_FOLDER_ID`** — the id of the shared Drive folder to index.
- **`GOOGLE_SERVICE_ACCOUNT_JSON`** — a Google service-account key JSON (single line), where the
  service account has at least Viewer access to that folder (share the folder with the service
  account's email).
- **`OPENROUTER_API_KEY`** — used to read documents via `google/gemini-2.5-flash`.
- **`OPENAI_API_KEY`** — used for `text-embedding-3-small` embeddings written to Qdrant.

Defaults that work as-is (override only if you want): `GEMINI_READ_MODEL=google/gemini-2.5-flash`,
`EMBED_MODEL=text-embedding-3-small`, `QDRANT_COLLECTION_LIBRARY=project_rag_library`.

### Part B steps (paste into the VPS Claude once you have the inputs)

```
TASK: Enable the Library "Sync" path for the rag_backend service. This adds env vars and ONE new
service (gotenberg) to /opt/rag-skripsi-stack. Do NOT modify n8n/postgres/qdrant/nginx.

1. Confirm the Qdrant service name on rag_internal_network:
     cd /opt/rag-skripsi-stack && docker compose config | grep -A2 -iE "qdrant:"
   Use that hostname for QDRANT_URL (DATABASE_URL already uses `@postgres:5432`, so the Qdrant
   service is reachable the same way — typically http://qdrant:6333).

2. Append the library env to the stack .env (gitignored; back it up first). Fill in the real
   secret values:
     cat >> /opt/rag-skripsi-stack/.env <<EOF

# --- Project RAG library (Drive -> Qdrant) ---
RAG_QDRANT_URL=http://qdrant:6333
RAG_GOTENBERG_URL=http://gotenberg:3000
RAG_DRIVE_FOLDER_ID=PUT_DRIVE_FOLDER_ID_HERE
RAG_OPENROUTER_API_KEY=PUT_OPENROUTER_KEY_HERE
RAG_OPENAI_API_KEY=PUT_OPENAI_KEY_HERE
EOF
   GOOGLE_SERVICE_ACCOUNT_JSON is large; set it as RAG_GOOGLE_SERVICE_ACCOUNT_JSON in the same
   .env on a single line (escape as needed), or paste it directly into the service `environment:`
   block in step 4.

3. Add a Gotenberg service to /opt/rag-skripsi-stack/docker-compose.yml under `services:`
   (two-space indent, same level as `postgres:`):

     gotenberg:
       image: gotenberg/gotenberg:8
       container_name: rag_gotenberg
       restart: unless-stopped
       expose:
         - "3000"
       networks:
         - rag_internal_network

4. Add these to the `rag_backend` service `environment:` block (map the stack .env vars into the
   app's env names the backend reads):
       QDRANT_URL: ${RAG_QDRANT_URL}
       QDRANT_COLLECTION_LIBRARY: project_rag_library
       GOTENBERG_URL: ${RAG_GOTENBERG_URL}
       DRIVE_FOLDER_ID: ${RAG_DRIVE_FOLDER_ID}
       GOOGLE_SERVICE_ACCOUNT_JSON: ${RAG_GOOGLE_SERVICE_ACCOUNT_JSON}
       OPENROUTER_API_KEY: ${RAG_OPENROUTER_API_KEY}
       OPENAI_API_KEY: ${RAG_OPENAI_API_KEY}
       GEMINI_READ_MODEL: google/gemini-2.5-flash
       EMBED_MODEL: text-embedding-3-small

5. Validate and start the new service + restart the backend:
     docker compose config >/dev/null && echo "compose OK"
     docker compose up -d gotenberg rag_backend
     docker compose ps     # rag_gotenberg Up, rag_backend Up; n8n/postgres/qdrant/nginx unchanged

6. Verify from the app: log in as admin, open the Library page, click "Sync library". Expect a
   summary like {added, updated, deleted, skipped, failed}. Check logs if failed > 0:
     docker compose logs --tail=50 rag_backend

GUARDRAILS:
- Only `gotenberg` is added and only `rag_backend` is restarted. Everything else keeps running.
- Don't commit secrets. Back up docker-compose.yml and .env before editing.
- The Qdrant collection `project_rag_library` is created automatically on first sync by the
  LangChain Qdrant store — no manual curl needed.
```

---

## Notes
- `node dist/src/db/migrate.js` applies only NEW migrations — here just `0007_bouncy_speed`
  (adds `library_documents`). Existing tables are untouched.
- Status works with **zero** library env: all the new config keys are optional, and the status
  endpoint only counts rows in `library_documents`. Only **Sync** needs Part B.
- The existing n8n RAG chat path is unaffected — `RAG_PROVIDER` stays `n8n` (default); the
  library code is a separate admin-only path.
