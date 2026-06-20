# project-rag-backend

A small, lightweight backend service built with Express 5 + TypeScript. It
provides server-side session authentication (httpOnly cookie, sessions stored in
Postgres) with no JWTs and no client-side tokens. Accounts are admin-created;
there is no public signup endpoint.

## Stack

- Express 5 + TypeScript (ESM, NodeNext)
- Postgres via `pg`
- Drizzle ORM + drizzle-kit for schema and migrations
- `express-session` + `connect-pg-simple` (sessions in Postgres)
- `@node-rs/argon2` for password hashing
- `zod` for env and request validation

## Environment variables

Copy `.env.example` to `.env` and fill in values:

| Variable         | Description                                              |
| ---------------- | -------------------------------------------------------- |
| `DATABASE_URL`   | Postgres connection string                               |
| `SESSION_SECRET` | Long random secret used to sign the session cookie       |
| `PORT`           | HTTP port (default `4000`)                               |
| `NODE_ENV`       | `development` \| `production` \| `test`                  |
| `COOKIE_SECURE`  | `true` only when serving over HTTPS                      |
| `COOKIE_SAMESITE`| Session cookie SameSite policy: `lax` (default) \| `strict` \| `none`. Use `none` for a genuinely cross-site SPA (requires `COOKIE_SECURE=true`); use `strict`/`lax` when the frontend and API share a registrable domain. |
| `CORS_ORIGIN`    | Allowed cross-origin (the frontend), e.g. `http://localhost:3000` |

## Running locally

```bash
npm install

# Start Postgres (and optionally the API) with Docker:
docker compose up -d db

# Generate the SQL migration from the schema, then apply it:
npm run db:generate
npm run db:migrate

# Create an admin account:
npm run create-admin -- admin@example.com 'a-strong-password' 'Admin Name'

# Run the dev server (auto-reload):
npm run dev
```

To run the full stack (db + api) in containers:

```bash
docker compose up --build
```

## Scripts

- `npm run dev` — start the dev server with auto-reload (tsx watch)
- `npm run build` — compile TypeScript to `dist`
- `npm start` — run the compiled server
- `npm run db:generate` — generate a migration from the schema
- `npm run db:migrate` — apply pending migrations
- `npm run create-admin` — create/upsert an admin user
- `npm run typecheck` — `tsc --noEmit`

## Endpoints

| Method | Path          | Description                                                |
| ------ | ------------- | --------------------------------------------------------- |
| GET    | `/health`     | Liveness probe; returns `{ status: "ok" }` after a DB ping |
| GET    | `/auth/csrf`  | Issues/returns the CSRF token (`{ csrfToken }`) and sets the `csrf_token` cookie |
| POST   | `/auth/login` | `{ email, password }`; sets session cookie on success     |
| POST   | `/auth/logout`| Destroys the session and clears the cookie (204)          |
| GET    | `/auth/me`    | Returns the current user, or 401 if not authenticated     |

Authentication is via an httpOnly session cookie. On login the session is
regenerated to prevent fixation, and login always returns a generic
`Invalid credentials` 401 (with timing-safe behavior) so it never reveals
whether an email exists. Login is rate limited (10 attempts per IP per 15
minutes) to throttle credential stuffing and brute force.

State-changing routes (`POST /auth/login`, `POST /auth/logout`) require CSRF
protection via a double-submit token: call `GET /auth/csrf` first, then send the
returned token in the `X-CSRF-Token` header on those requests. The session
cookie's `SameSite` policy is controlled by `COOKIE_SAMESITE`.

The session store table (`user_sessions`) is created by an explicit migration
(`npm run db:migrate`); the app role does not create it at runtime, so it only
needs DML privileges on that table.
