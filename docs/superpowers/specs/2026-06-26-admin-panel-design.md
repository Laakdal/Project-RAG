# Admin Panel — Design Spec

**Date:** 2026-06-26
**Status:** Approved design, pending implementation plan
**Scope:** Single-team internal admin panel for user management + aggregate stats, plus self-service password change for all users.

---

## 1. Goal & Context

Project-RAG currently has authentication (server-side sessions, argon2) and a `users` table with a single `isAdmin` boolean, but no way for an admin to manage users from the UI. The frontend has leftover empty stubs under `app/(main)/@sidebar/workspace/*` (users, teams, groups, profile, etc.) from a deleted upstream admin tree.

This spec fills in the **user-management** slice and a small **aggregate stats** strip, and adds a **self-service password change** for every user. It is explicitly scoped for a **single-team internal** deployment where admins are trusted operators and there is no per-user chat-privacy boundary.

### Out of scope (YAGNI)
- Teams / groups / connectors / AI-model / web-search stubs — stay empty.
- Email / invite-link flow — admin sets the initial password directly.
- Editing a user's name/email after creation.
- Audit logging.
- Token / cost ("Tier 2") usage tracking — deferred to a future spec; requires instrumenting n8n to record per-call token usage.

---

## 2. Feature Summary

**Admin user management** (admin-only):
1. Create user — admin supplies email, name, initial password, and whether they're an admin.
2. Toggle admin — grant/revoke the `isAdmin` flag.
3. Disable / enable user — block login without deleting.
4. Reset password — admin sets a new password for any user (no current password required).
5. Delete user — hard-remove with cascade of their conversations, messages, and attachments.

**Aggregate stats** (Tier 1, admin-only): counts pulled directly from our own Postgres.

**Self-service password change** (every authenticated user): change own password by proving the current one.

---

## 3. Backend

### 3.1 Schema change

One Drizzle migration:

- Add `disabledAt timestamptz NULL` to `users`. `NULL` = active; a timestamp = disabled (and records when).
- Ensure `ON DELETE CASCADE` exists on the FKs from `conversations` → `messages`/`attachments` and from `users` → `conversations`, so deleting a user removes their data. If the cascade is not already declared in the schema, add it in this migration; otherwise the delete route performs the cascade inside a transaction.

### 3.2 Authorization middleware

New `requireAdmin()` in `backend/src/auth/middleware.ts`:
- Runs after `requireAuth`.
- Loads the user (without password hash); returns **403** if `isAdmin` is false.
- All `/admin/*` routes sit behind it.

### 3.3 Login change

In `backend/src/auth/routes.ts` login handler: after verifying the password, reject users whose `disabledAt` is not null with **403** and a clear message ("This account has been disabled"). No session is created for disabled users.

### 3.4 Admin API routes

New router `backend/src/admin/routes.ts`, mounted at `/admin` in `server.ts`, all behind `requireAuth` + `requireAdmin`:

| Method | Path | Action | Notes |
|---|---|---|---|
| GET | `/admin/users` | List users | No password hash; includes conversation count and `disabledAt`/`isAdmin` |
| POST | `/admin/users` | Create user | Body: `email`, `name`, `password`, `isAdmin`; argon2-hashes password; 409 on duplicate email |
| PATCH | `/admin/users/:id/admin` | Toggle `isAdmin` | Body: `isAdmin: boolean` |
| PATCH | `/admin/users/:id/disabled` | Disable/enable | Body: `disabled: boolean` → sets/clears `disabledAt` |
| POST | `/admin/users/:id/password` | Reset password | Body: `newPassword`; argon2; **no current password** (admin authority is the gate) |
| DELETE | `/admin/users/:id` | Delete user | Cascades conversations → messages → attachments |
| GET | `/admin/stats` | Aggregate counts | See 3.6 |

### 3.5 Guardrails

A small `backend/src/admin/guards.ts` helper, enforced **server-side** (not just hidden in the UI). Violations return **409 Conflict** with a clear message:

- An admin cannot **delete**, **disable**, or **demote** their own account (compare `:id` against `req.session.userId`).
- The **last remaining admin** cannot be demoted, disabled, or deleted (count admins where `disabledAt IS NULL` before allowing the change).

### 3.6 Stats endpoint

`GET /admin/stats` returns aggregate counts from Postgres only — no per-user content:

- total users, disabled users, admin count
- total conversations, total messages, total attachments
- ingestion failures (count of attachments in a failed state, if such a status column exists; otherwise omit until ingestion status is tracked)

### 3.7 Self-service password change

New `POST /auth/change-password` in `backend/src/auth/routes.ts`, behind `requireAuth` only (not admin):

- Body: `currentPassword`, `newPassword`.
- Verifies `currentPassword` against the stored argon2 hash; returns **400** if wrong.
- On success, hashes and stores `newPassword`.
- Rationale: requiring the current password ensures a hijacked session can't silently change the password. This is the key difference from the admin reset, which relies on admin authority instead.

---

## 4. Frontend

Stack: Next.js 15 App Router, React 19, `@radix-ui/themes`, Zustand auth store, axios + SWR. CSS in `globals.css` (no Tailwind).

### 4.1 Admin user management page

Wire up the existing stubs:
- `app/(main)/@sidebar/workspace/users/page.tsx` (sidebar) and the corresponding workspace content page.
- Route protection: read `isAdmin` from the auth store; redirect non-admins away from `/workspace/users`.

API client: extend `lib/api/users.ts` with the admin mutations and add `lib/api/admin.ts` for stats. All mutations go through the existing axios instance (cookies + CSRF token).

UI:
- **Stats strip** at the top — small cards from `GET /admin/stats`.
- **Users table** — columns: email, name, admin badge, status (active/disabled), conversation count, and a row-actions menu: toggle admin, disable/enable, reset password, delete.
- **Create-user dialog** — email, name, password, "make admin" checkbox.
- **Reset-password dialog** — new password field.
- **Confirm dialogs** for delete (warns about cascade) and disable.
- Actions that would violate a guardrail (own account; last admin) are disabled client-side *and* enforced server-side.

### 4.2 Self-service password change

In the existing profile stub `app/(main)/@sidebar/workspace/profile/page.tsx` (and its content page):
- A **"Change password"** card — current password, new password, confirm new password — calling `POST /auth/change-password`.
- Available to all authenticated users (not gated on `isAdmin`).

---

## 5. Testing

Vitest is currently configured to skip tests (`include: []`). Enable it for the admin and auth modules and cover:

- **Guardrails:** cannot demote/disable/delete self; cannot remove the last admin.
- **Disabled login:** a user with `disabledAt` set is rejected at login (403).
- **Cascade delete:** deleting a user removes their conversations, messages, attachments.
- **Password reset (admin):** sets a new working hash; target user can then log in with it.
- **Self password change:** wrong current password → 400; correct → new password works, old one fails.

Frontend: manual verification of the admin page and profile card unless component tests are requested.

---

## 6. Endpoint Reference (summary)

```
# Admin (requireAuth + requireAdmin)
GET    /admin/users
POST   /admin/users
PATCH  /admin/users/:id/admin
PATCH  /admin/users/:id/disabled
POST   /admin/users/:id/password
DELETE /admin/users/:id
GET    /admin/stats

# Self-service (requireAuth)
POST   /auth/change-password
```

---

## 7. Key Decisions

- **Disable via `disabledAt` timestamp** (not a boolean) — captures *when* and keeps a single nullable column.
- **Delete cascades** all of the user's chat data (option A) — clean removal, accepted risk of data loss, guarded by a confirm dialog.
- **Guardrails enforced server-side** — UI disabling is convenience only; the server is the source of truth.
- **Two distinct password paths** — admin reset (authority-gated, no current password) vs. self change (proves current password).
