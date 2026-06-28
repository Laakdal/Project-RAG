# Audit Log — Design Spec

**Date:** 2026-06-28
**Status:** Approved design, pending implementation plan
**Scope:** An append-only audit log of successful admin user-management actions, viewable on a dedicated admin page. Builds on the existing admin panel.

---

## 1. Goal & Context

The admin panel performs destructive, account-level actions (create, toggle admin, disable/enable, reset password, delete-with-cascade) with no record of who did what. This adds an **audit log**: every successful admin user-management mutation writes an immutable row capturing the actor, the target, and what changed, viewable by admins on a dedicated page.

Single-team internal deployment. Accountability is the goal, not security monitoring or compliance.

### Out of scope (YAGNI)
- Logging **denied/guardrail-blocked** attempts (only successes are recorded).
- Auth events (logins, failed logins, logouts) — a future "Tier B" scope.
- Self-service / content events (password self-change, attachment or conversation deletes).
- Filtering/search on the audit page (simple pagination only in v1).
- Retention/pruning, export, and tamper-proofing (append-only is enough for now).

---

## 2. What gets logged

The five mutating `/admin` routes, on success only:

| Route | `action` | `details` |
|---|---|---|
| `POST /admin/users` | `user.create` | `{ isAdmin }` |
| `PATCH /admin/users/:id/admin` | `user.set_admin` | `{ isAdmin: <new value> }` |
| `PATCH /admin/users/:id/disabled` | `user.set_disabled` | `{ disabled: <new value> }` |
| `POST /admin/users/:id/password` | `user.reset_password` | `{}` (never the password) |
| `DELETE /admin/users/:id` | `user.delete` | `{}` |

Every row also captures the **actor** (who), **target** (which user), **timestamp**, **IP**, and **user-agent**.

---

## 3. Backend — data model

New migration `backend/migrations/0006_audit_logs.sql` + `auditLogs` table in `backend/src/db/schema.ts`. **Append-only.**

```
audit_logs
  id             uuid pk default gen_random_uuid()
  created_at     timestamptz not null default now()
  actor_user_id  uuid            -- nullable, NO FK / NO cascade
  actor_email    text not null   -- snapshot at write time
  action         text not null
  target_user_id uuid            -- nullable, NO FK / NO cascade
  target_email   text            -- snapshot at write time (nullable)
  details        jsonb           -- action-specific; never secrets
  ip_address     text
  user_agent     text
```

**Why no FK / no cascade and email snapshots:** the record must survive deletion. Deleting a user must not erase "admin X deleted bob@…", and an actor's history must survive if they are later removed. So `actor_user_id`/`target_user_id` are plain uuids (not cascading FKs), and the human-readable email is captured at write time.

Index: `create index on audit_logs (created_at desc)` for the newest-first page query.

---

## 4. Backend — recording mechanism

New `backend/src/admin/audit.ts`:

```ts
export const AUDIT_ACTIONS = {
  userCreate: "user.create",
  userSetAdmin: "user.set_admin",
  userSetDisabled: "user.set_disabled",
  userResetPassword: "user.reset_password",
  userDelete: "user.delete",
} as const;

/**
 * Best-effort: writes one audit row. Never throws — a logging failure must not
 * fail the admin action that triggered it. Actor identity comes from req.user
 * (populated by attachUser on the admin router).
 */
export async function recordAudit(
  req: Request,
  entry: {
    action: string;
    targetUserId?: string | null;
    targetEmail?: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> { /* insert; try/catch → console.error on failure */ }
```

- **Actor identity:** the admin router gains the existing `attachUser` middleware (`router.use(requireAuth); router.use(attachUser); router.use(requireAdmin);`) so `req.user` (id + email) is available to every admin route. `recordAudit` reads `req.user.id` / `req.user.email`.
- **IP / UA:** `req.ip` (Express `trust proxy` is already set in `server.ts`, so this reflects the real client) and `req.get("user-agent")`.
- **When called:** at the end of each mutation, **after** the DB write succeeds and **before** the response is sent; the route `await`s it (the insert is fast, and awaiting means the audit page reflects the action immediately). Because it only runs after success, denied/guardrail paths produce no rows.
- **Target snapshot capture:** each route already has, or is extended to return, the target email:
  - create → from the insert `returning` (already selects `userColumns`, which includes email)
  - toggle admin → extend its `.returning({ id })` to `.returning({ id, email })`
  - disable/enable, delete → from `loadUserWithAdminContext` (already returns `email`); for delete, captured **before** the row is removed
  - reset password → extend its `.returning({ id })` to `.returning({ id, email })`

---

## 5. Backend — viewing endpoint

`GET /admin/audit?page=&limit=` (admin-only, behind the same `requireAuth` + `attachUser` + `requireAdmin`):
- Newest-first (`order by created_at desc`), paginated (default `limit=50`, `page=1`).
- Returns `{ entries: AuditEntry[], page, limit, total }` where `total` is the full row count.
- `AuditEntry` = `{ id, createdAt, actorEmail, action, targetUserId, targetEmail, details, ipAddress, userAgent }` (actor/target ids included for completeness; the UI shows emails).
- No write/update/delete endpoints for audit rows — immutability is enforced by simply not exposing them.

---

## 6. Frontend

- **API client** (`frontend/lib/api/admin.ts`): add `AuditEntry` + `AuditPage` types and `AdminApi.listAudit(page = 1, limit = 50): Promise<AuditPage>` → `GET /admin/audit`. (The existing `/admin/:path*` Next rewrite already proxies this — no `next.config` change.)
- **Page** (`frontend/app/(main)/workspace/audit-log/page.tsx`): admin-gated (same redirect-non-admins guard as the users page). A reverse-chron table — **When · Who · Action · Target · Details** — with Prev/Next pagination driven by `total`/`limit`. `action` is humanized client-side:
  - `user.create` → "Created user"
  - `user.set_admin` → "Granted admin" / "Revoked admin" (per `details.isAdmin`)
  - `user.set_disabled` → "Disabled account" / "Enabled account" (per `details.disabled`)
  - `user.reset_password` → "Reset password"
  - `user.delete` → "Deleted user"
- **Nav** (`frontend/app/(main)/workspace/sidebar/index.tsx`): add `{ icon: 'history', label: 'Audit log', route: '/workspace/audit-log' }` to the admin-only `ADMIN_ITEMS`, beside "Users".

---

## 7. Testing

Backend (Vitest + supertest, existing db-mock harness in `backend/src/test/app-harness.ts`):
- Each of the five mutations writes an `audit_logs` row with the correct `action` and target (assert the `insert`/`values` spy is called with the `auditLogs` table and the expected `action`/`targetEmail`/`details`).
- `GET /admin/audit` returns entries newest-first (assert the `order by created_at desc`) and the `{ entries, page, limit, total }` shape.
- **Best-effort:** when the audit insert throws, the triggering route still returns its success status (mock the audit insert to reject; assert the route is still 201/204 and the error was swallowed).
- The audit `details` for `user.reset_password` contains no password material.

Frontend: manual verification (no component-test runner), consistent with the admin panel.

---

## 8. Key Decisions

- **Append-only, snapshots, no cascade** — the log outlives the users it references.
- **Successes only** — denied/guardrail attempts are out of scope; no `status` column needed.
- **Best-effort writes** — a logging failure logs an error but never fails the admin action.
- **Reuse `attachUser`** on the admin router for actor identity rather than re-querying per route.
- **Keep forever** — no pruning; admin-action volume is tiny.
