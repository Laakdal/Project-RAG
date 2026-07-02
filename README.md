# Project RAG

A retrieval-augmented chat application: a Next.js frontend, an Express/TypeScript
backend with server-side session auth, and an n8n-driven RAG pipeline for
ingesting documents and answering questions over them.

## Overview

- **Chat over your documents.** Upload files to a conversation (PDF, DOCX, XLSX,
  PPTX, images, plain text) and ask questions; the whole document is read into
  context per chat for grounded answers.
- **Rich answers.** Responses can include Mermaid diagrams and, for
  "which is better" questions, a factor table with a recommendation.
- **Admin-created accounts.** Authentication is via an httpOnly session cookie
  (sessions stored in Postgres, no JWTs). There is no public signup.

## Architecture

| Layer      | Stack                                                                 |
| ---------- | --------------------------------------------------------------------- |
| Frontend   | Next.js 15 + React 19 + TypeScript                                     |
| Backend    | Express 5 + TypeScript, Postgres via Drizzle ORM, `express-session`   |
| RAG        | n8n workflows (document ingest/read + answer generation)              |
| Auth       | Server-side sessions (httpOnly cookie), `@node-rs/argon2` hashing      |

```
frontend/  → Next.js app (chat UI, auth, file uploads)
backend/    → Express API (auth, sessions, chat/RAG routes)   see backend/README.md
deploy/     → deployment assets
docs/       → design specs and documentation
```

## Getting started

Each app runs independently. See the per-app docs for details.

### Backend

```bash
cd backend
npm install
docker compose up -d db      # start Postgres
npm run db:generate && npm run db:migrate
npm run create-admin -- admin@example.com 'a-strong-password' 'Admin Name'
npm run dev                  # http://localhost:4000
```

Full setup, environment variables, and endpoints are documented in
[`backend/README.md`](backend/README.md).

### Frontend

```bash
cd frontend
npm install
npm run dev                  # http://localhost:3001
```

Configure `NEXT_PUBLIC_*` variables and API rewrites (`next.config`) to point at
the backend before building.

## Deployment

The stack ships with Docker Compose files:

- `docker-compose.yml` — local full stack (db + backend)
- `docker-compose.vps.yml` — VPS backend stack
- `docker-compose.frontend.yml` — frontend container

## License

Private project. All rights reserved.
