# Frontend Login Wiring — Design Spec

**Date:** 2026-06-20
**Scope option chosen:** #1 — *working email+password login against the session backend, plus tidying the login surface*. The app-wide JWT/token-plumbing teardown is explicitly deferred.

## Goal & success criteria

Make the existing Next.js frontend log in against the new session-based backend (`backend/`, Express + Postgres, server-side sessions).

Done when, against a local Postgres + running backend with one admin user seeded via `backend/scripts/create-admin.ts`:

1. Visiting `/login`, entering a valid admin email + password, lands on `/chat` as that user.
2. The session survives a full page refresh (no re-login).
3. The authenticated shell shows the real user's name and correct admin status (Decision A).
4. **Logout** returns the user to `/login` and the session no longer works.
5. A wrong password shows an inline "Invalid credentials" message.
6. No JWTs and no `localStorage` auth tokens are used; auth state comes from the `connect.sid` session cookie + `GET /auth/me`.

## Backend contract (already built — frontend must conform to this)

Base URL: `http://localhost:4000`. CORS already allows `http://localhost:3000` with credentials; allowed headers include `x-csrf-token`.

| Method & path | Notes |
| --- | --- |
| `GET /auth/csrf` | Returns `{ csrfToken }` and sets a **JS-readable** `csrf_token` cookie. |
| `POST /auth/login` | Body `{ email, password }`. **Requires** header `x-csrf-token` matching the `csrf_token` cookie. Rate-limited (10 / 15 min). On success sets httpOnly `connect.sid` cookie and returns `{ id, email, name, isAdmin }`. `401` on bad credentials, `400` invalid body, `403` bad CSRF. |
| `POST /auth/logout` | Requires CSRF. Returns `204` and clears the session cookie. |
| `GET /auth/me` | Returns `{ id, email, name, isAdmin, createdAt, lastLoginAt }` if a valid session exists, else `401`. This is the source of truth for "am I logged in." |

There is no JWT, no refresh token, and no `initAuth` / OAuth / SAML / OTP on the backend.

## Design — changes by file

### 1. Config / base URL
- `frontend/.env.local`: set `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000`.

### 2. New thin auth API module
- Implement the new calls in the existing auth API home, `frontend/app/(public)/api.ts` (replacing the trimmed methods from §10), exposing exactly:
  - `getCsrfToken()` → `GET /auth/csrf`, returns the token (and seeds the cookie).
  - `login(email, password)` → `POST /auth/login`, returns the user object.
  - `logout()` → `POST /auth/logout`.
  - `getMe()` → `GET /auth/me`, returns the user or throws/returns null on 401.
- These replace the upstream `initAuth` + `authenticate` multi-step flow.

### 3. CSRF handling
- Add a helper that reads the `csrf_token` cookie value from `document.cookie`.
- Add an axios **request interceptor** that, on mutating methods (POST/PUT/PATCH/DELETE), attaches `x-csrf-token` from that cookie when present (harmless no-op when absent). Applied generally (future-proof); can be scoped to `/auth/*` later if desired.
- Before `POST /auth/login`, call `getCsrfToken()` to guarantee the cookie exists.

### 4. axios changes — `frontend/lib/api/axios-instance.ts`
- **Keep** `withCredentials: true` so the browser sends cookies.
- **Remove** from the request interceptor: the JWT `Authorization: Bearer` attach, the `isTokenExpired` proactive-refresh check, and the call into `refreshAccessToken()`.
- **Remove** from the response interceptor: the `401 → refresh token → retry` logic. A `401` now means the session is gone → clear auth state and route to `/login`.
- Keep the dynamic `baseURL`/Electron-override behavior and the error-toast behavior.

### 5. Auth store — `frontend/lib/store/auth-store.ts`
- `isAuthenticated` and `user` now derive from a successful `GET /auth/me`, not from stored tokens.
- Per scope #1, the `accessToken` / `refreshToken` fields and their `localStorage` keys are **left in place but unused** (their removal is the deferred #3 work). They are simply no longer written or read for auth decisions.
- `logout()` action clears in-memory `user` / `isAuthenticated`.

### 6. Hydration — reuse `frontend/lib/store/auth-hydrator.tsx`
- On mount, instead of reading tokens from `localStorage`, call `GET /auth/me`:
  - `200` → set `user` + `isAuthenticated = true`.
  - `401` → `isAuthenticated = false`.
  - Either way → set `isHydrated = true` when the check resolves.
- Remove the `initTokenRefreshScheduler()` call (the refresh scheduler is deleted — see §10).
- `AuthGuard` / `GuestGuard` are unchanged: they already gate on `isAuthenticated && isHydrated`, so they keep working with the new source of truth.

### 7. Login form — `frontend/app/(public)/forms/single-provider.tsx` + `use-auth-actions.ts`
- The form already collects email + password; the UI does not change.
- Rewrite the password sign-in handler to: ensure CSRF (`getCsrfToken()`) → `POST /auth/login { email, password }` → on success set auth + profile state and route to `/chat`; on `401` show "Invalid credentials" inline.

### 8. Logout
- Call `POST /auth/logout` (CSRF attached by the interceptor), then clear the store and route to `/login`. The existing `logoutFromWorkspaceMenu` / `logoutAndRedirect` paths are repointed to this.

### 9. Decision A — user profile from `/auth/me`
- The authenticated shell reads a separate `user-store` profile (name, isAdmin, avatar) via `UserProfileInitializer`, which currently fetches `/api/v1/users/{id}`, `/api/v1/userGroups/users/{id}`, and `/api/v1/users/dp` — all of which 404 against the new backend.
- Map the `/auth/me` payload into the `user-store` profile: set `fullName` from `name`, plus `email` and `isAdmin`; leave `firstName`/`lastName` empty (the shell displays `fullName`) and `avatarUrl` blank (no avatar source yet).
- Short-circuit the three dead `/api/v1/users/*` calls in `UserProfileInitializer` so they no longer fire (and no longer error). Populate the profile from the data we already have after login / `/auth/me`.

### 10. Login-surface dead-code removal (the "trim")
Rewrite `app/(public)/api.ts` (drop all `AuthApi` methods except the four new calls) and rewrite `use-auth-actions.ts` to password-only — removing the login page's use of `initAuth`/Google/Microsoft/OAuth/OTP/forgot-password and the `x-session-token` plumbing.

**Deferred (discovered during planning):** the shared lower-level modules `post-user-account-authenticate.ts`, `token-refresh.ts`, and `token-refresh-scheduler.ts` are **not** physically deleted in this change — `token-refresh.ts` is still imported by `streaming.ts`, `post-user-account-authenticate.ts` by the workspace authentication settings API, and deleting them would pull in files outside the login surface. They are disconnected from the login path here and deleted in the later app-wide purge. Likewise `hydrate-user.ts` and `use-initialize-user-profile.ts` become unreferenced and are deleted then. This keeps the change inside #1's "defer app-wide token plumbing" boundary.

### 11. Decision B — keep the dev bypass (adapted)
- `DEV_BYPASS_AUTH` is kept for no-backend/no-database preview.
- Adapt it to seed **session-style state** rather than a fake JWT: when enabled, set `isAuthenticated = true` + a fake `user` in the auth store and seed the `user-store` profile (reuse `DEV_FAKE_PROFILE`), and have `AuthGuard` short-circuit as it does today. No fake token is minted.

## Out of scope (deferred)
- The app-wide token-plumbing purge (#3): removing `accessToken`/`refreshToken` fields and `localStorage` keys from the store, deleting JWT utils (`lib/auth/jwt.ts` expiry/decode helpers), and cleaning the Electron Bearer-token branch.
- The `org-exists` / `/sign-up` first-install flow (inert dead code today).
- All other `/api/v1/*` feature endpoints (conversations, agents, knowledge-base, connectors, etc.) — they have no backend yet and continue to 404.

## Testing
- Manual end-to-end against a local Postgres + the running backend, with one admin user created via `backend/scripts/create-admin.ts`.
- Verify the six success criteria above, including refresh-persistence and that logout invalidates the session (a subsequent `/auth/me` returns 401).
- Note: the repo's Vitest is configured with `include: []`, so there is no live automated unit-test harness to extend; verification here is manual. (Standing this harness up is a separate task.)

## Risks / notes
- The `connect.sid` cookie is cross-origin between `localhost:3000` (frontend) and `localhost:4000` (backend), but these are the **same site**, so `SameSite=lax` + `COOKIE_SECURE=false` works over plain http locally. No change needed for local dev; production cookie/SameSite settings are a backend deployment concern.
- Removing `token-refresh.ts` requires that §4 and §6 (which reference it) are updated in the same change to avoid a broken import.
