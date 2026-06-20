# Frontend Login Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Next.js frontend log in with email + password against the new session-cookie backend, drive the profile from `/auth/me`, and tidy the login code surface.

**Architecture:** Replace the JWT/localStorage + `initAuth`/OAuth/SAML flow with four thin calls to `/auth/*`. Auth state derives from `GET /auth/me` (probed on app mount) and the httpOnly `connect.sid` session cookie; CSRF uses a double-submit cookie + `x-csrf-token` header. A new `lib/auth/session.ts` owns the session bootstrap, profile mapping, and sign-out so stores stay free of import cycles.

**Tech Stack:** Next.js 15 (App Router), React 19, Zustand, axios (`withCredentials`), Radix Themes. Backend: Express + Postgres sessions on `http://localhost:4000`.

## Global Constraints

- Backend base URL: `http://localhost:4000` (set via `NEXT_PUBLIC_API_BASE_URL`).
- CSRF: JS-readable cookie `csrf_token`, echoed in header `x-csrf-token`; required on `POST /auth/login` and `POST /auth/logout`.
- Session cookie: httpOnly `connect.sid` (browser-managed; never read in JS).
- Login is rate-limited 10 / 15 min; `401` = invalid credentials (login) or dead session (other calls).
- Endpoints: `GET /auth/csrf` → `{csrfToken}`; `POST /auth/login {email,password}` → `{id,email,name,isAdmin}`; `POST /auth/logout` → 204; `GET /auth/me` → user or 401.
- No new npm dependencies.
- Verification gate per task: `cd frontend && npx tsc --noEmit` exits 0 (the repo has no live unit-test harness — Vitest is configured with `include: []` — so each task is gated by typecheck + the manual checks noted, not automated tests).
- Commit message style (per project convention): plain imperative messages, **no** conventional-commit prefixes (no `feat:`/`fix:`), and never reference the upstream "pipeshub" name.
- Scope is #1 (login surface). Out of scope / deferred: removing `accessToken`/`refreshToken` store fields + localStorage keys, `lib/utils/jwt.ts` helpers, the Electron Bearer branch, and physically deleting `token-refresh.ts`, `token-refresh-scheduler.ts`, `post-user-account-authenticate.ts`, `hydrate-user.ts`, `use-initialize-user-profile.ts` (these are disconnected from the login path here, deleted in the later purge).

---

## Prerequisites (local setup — not committed)

`frontend/.env.local` is gitignored; edit it directly:

```
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
NEXT_PUBLIC_DEV_BYPASS_AUTH=0
```

Bring up the backend with one admin user (run from `backend/`):

```bash
# Postgres must be running and DATABASE_URL/SESSION_SECRET set in backend/.env
npm run migrate          # apply migrations (creates users + user_sessions tables)
npx tsx scripts/create-admin.ts   # follow prompts to create an admin email+password
npm run dev              # backend listens on :4000
```

> Confirm `curl -i http://localhost:4000/health` returns `{"status":"ok"}` before testing login.

---

## Task 1: Switch the axios client to session-cookie auth + CSRF

**Files:**
- Create: `frontend/lib/api/csrf.ts`
- Modify: `frontend/lib/api/axios-instance.ts` (full rewrite)

**Interfaces:**
- Produces: `readCsrfCookie(): string | null`, `CSRF_COOKIE_NAME`, `CSRF_HEADER_NAME` (from `csrf.ts`); the `apiClient` now honors a per-request `skipAuthRedirect?: boolean` config flag and attaches the CSRF header on mutating methods.
- Consumes: existing `logoutAndRedirect` (auth-store), `processError`, `showErrorToast`, `getApiBaseUrl`, `applyElectronOverrides`.

- [ ] **Step 1: Create the CSRF cookie reader**

Create `frontend/lib/api/csrf.ts`:

```ts
/**
 * Double-submit CSRF helpers. The backend sets a JS-readable `csrf_token`
 * cookie (GET /auth/csrf); we mirror its value into the x-csrf-token header on
 * state-changing requests so the server can prove the call came from our SPA.
 */
export const CSRF_COOKIE_NAME = 'csrf_token';
export const CSRF_HEADER_NAME = 'x-csrf-token';

export function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${CSRF_COOKIE_NAME}=`;
  const row = document.cookie.split('; ').find((c) => c.startsWith(prefix));
  return row ? decodeURIComponent(row.slice(prefix.length)) : null;
}
```

- [ ] **Step 2: Rewrite the axios instance**

Replace the entire contents of `frontend/lib/api/axios-instance.ts` with:

```ts
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { logoutAndRedirect } from '@/lib/store/auth-store';
import { processError } from './api-error';
import { showErrorToast } from './error-toast';
import { getApiBaseUrl } from '@/lib/utils/api-base-url';
import { applyElectronOverrides } from '@/lib/electron';
import { readCsrfCookie, CSRF_HEADER_NAME } from './csrf';

declare module 'axios' {
  export interface AxiosRequestConfig {
    /** Suppress the global error toast for this request. */
    suppressErrorToast?: boolean;
    /** Do not run the global 401 → logout/redirect for this request. */
    skipAuthRedirect?: boolean;
  }
}

// Default to '' (same origin). A single sentinel avoids `"undefined"` leaking
// into template-built URLs when `NEXT_PUBLIC_API_BASE_URL` is unset.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
const API_TIMEOUT = 90_000;

const MUTATING_METHODS = new Set(['post', 'put', 'patch', 'delete']);

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// ── Request interceptor ────────────────────────────────────────────────────
// Auth rides on the httpOnly session cookie (sent automatically via
// withCredentials). We only need to align the baseURL, apply Electron
// overrides, and attach the double-submit CSRF token on state-changing calls.
apiClient.interceptors.request.use(
  (config) => {
    config.baseURL = getApiBaseUrl();
    applyElectronOverrides(config);

    const method = (config.method ?? 'get').toLowerCase();
    if (MUTATING_METHODS.has(method)) {
      const csrf = readCsrfCookie();
      if (csrf) {
        config.headers.set(CSRF_HEADER_NAME, csrf);
      }
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// ── Response interceptor ───────────────────────────────────────────────────
// In the session-cookie model there is no token refresh: a 401 means the
// session is gone, so clear state and route to /login — unless the caller opted
// out via `skipAuthRedirect` (e.g. the /auth/me probe and the login call, which
// handle 401 themselves).
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (error.response?.data instanceof Blob) {
      try {
        const text = await error.response.data.text();
        error.response.data = JSON.parse(text);
      } catch (parseError) {
        console.warn('Failed to parse Blob error response as JSON:', parseError);
      }
    }

    const originalRequest = error.config as InternalAxiosRequestConfig | undefined;

    if (error.response?.status === 401) {
      if (!originalRequest?.skipAuthRedirect) {
        logoutAndRedirect();
      }
      return Promise.reject(processError(error));
    }

    const processedError = processError(error);
    if (!originalRequest?.suppressErrorToast) {
      showErrorToast(processedError);
    }
    return Promise.reject(processedError);
  },
);

export { apiClient as default };
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: exits 0. (`token-refresh.ts` / `token-refresh-scheduler.ts` remain on disk — still imported by `streaming.ts` and `auth-hydrator.tsx` respectively — so nothing breaks.)

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api/csrf.ts frontend/lib/api/axios-instance.ts
git commit -m "Switch axios client to session-cookie auth with CSRF header"
```

---

## Task 2: Replace the login flow (API + session bootstrap + form)

This is one reviewable unit because the pieces don't typecheck independently (the new `api.ts` removes methods the old `use-auth-actions.ts` calls, and `session.ts` needs the new `setSession` action).

**Files:**
- Modify: `frontend/app/(public)/api.ts` (full rewrite)
- Create: `frontend/lib/auth/session.ts`
- Modify: `frontend/lib/store/auth-store.ts` (add `setSession`; remove dead JWT-seed + `hydrateAuthStore`)
- Modify: `frontend/lib/dev/dev-bypass.ts` (remove `makeFakeJwt`)
- Modify: `frontend/lib/store/auth-hydrator.tsx` (call `hydrateSession`)
- Modify: `frontend/app/(public)/hooks/use-auth-actions.ts` (full rewrite → password only)
- Modify: `frontend/app/(public)/forms/single-provider.tsx` (error union)

**Interfaces:**
- Produces: `AuthApi.{getCsrf,login,logout,getMe}` and `AuthUser` (api.ts); `applyAuthUser(user)`, `clearSession()`, `hydrateSession()`, `signOut()` (session.ts); `useAuthStore` action `setSession(user: User | null)`.
- Consumes: `apiClient` + `skipAuthRedirect` flag (Task 1); `useUserStore.setProfile/setInitialized/clearProfile`; `DEV_BYPASS_AUTH`, `DEV_FAKE_PROFILE`.

- [ ] **Step 1: Rewrite the auth API module**

Replace the entire contents of `frontend/app/(public)/api.ts` with:

```ts
import { apiClient } from '@/lib/api';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
  createdAt?: string;
  lastLoginAt?: string | null;
}

// These calls handle their own 401s (invalid creds / no session), so opt out of
// the global redirect + toast.
const AUTH_REQUEST_CONFIG = {
  skipAuthRedirect: true,
  suppressErrorToast: true,
} as const;

/** Seed/refresh the CSRF cookie and return the current token. */
async function getCsrf(): Promise<string> {
  const { data } = await apiClient.get<{ csrfToken: string }>(
    '/auth/csrf',
    AUTH_REQUEST_CONFIG,
  );
  return data.csrfToken;
}

/** Email + password sign-in. Ensures CSRF, sets the session cookie, returns the user. */
async function login(email: string, password: string): Promise<AuthUser> {
  await getCsrf();
  const { data } = await apiClient.post<AuthUser>(
    '/auth/login',
    { email, password },
    AUTH_REQUEST_CONFIG,
  );
  return data;
}

/** End the session server-side. */
async function logout(): Promise<void> {
  await getCsrf();
  await apiClient.post('/auth/logout', undefined, AUTH_REQUEST_CONFIG);
}

/** Current user if a valid session exists, else null. */
async function getMe(): Promise<AuthUser | null> {
  try {
    const { data } = await apiClient.get<AuthUser>('/auth/me', AUTH_REQUEST_CONFIG);
    return data;
  } catch {
    return null;
  }
}

export const AuthApi = { getCsrf, login, logout, getMe };
export default AuthApi;
```

- [ ] **Step 2: Add `setSession` to the auth store**

In `frontend/lib/store/auth-store.ts`, add to the `AuthActions` interface (after `setUser`):

```ts
  setSession: (user: User | null) => void;
```

Add the action implementation inside the store (after the `setUser` action):

```ts
      setSession: (user) =>
        set((state) => {
          state.user = user;
          state.isAuthenticated = !!user;
        }),
```

- [ ] **Step 3: Remove the dead JWT seeding + localStorage hydration from the auth store**

In `frontend/lib/store/auth-store.ts`:

1. Delete the import on line 9: `import { DEV_BYPASS_AUTH, makeFakeJwt } from '@/lib/dev/dev-bypass';`
2. Delete the entire `hydrateAuthStore` function (the `export function hydrateAuthStore(): void { ... }` block).
3. Delete the module-bottom client block that removes `auth-storage`, seeds the fake JWT, and calls `hydrateAuthStore()` (the `if (typeof window !== 'undefined') { ... }` block).

Leave `setTokens`, `setAccessToken`, `logout`, `writeAccessToken`, `writeRefreshToken`, the storage-key constants, `logoutAndRedirect`, `logoutFromWorkspaceMenu`, the event constants, and the selectors unchanged (deferred cleanup).

- [ ] **Step 4: Drop the now-unused fake-JWT helper**

In `frontend/lib/dev/dev-bypass.ts`, delete the `b64url` function and the `makeFakeJwt` function. Keep `DEV_BYPASS_AUTH` and `DEV_FAKE_PROFILE`.

- [ ] **Step 5: Create the session bootstrap module**

Create `frontend/lib/auth/session.ts`:

```ts
'use client';

import { AuthApi, type AuthUser } from '@/app/(public)/api';
import { useAuthStore, logoutFromWorkspaceMenu } from '@/lib/store/auth-store';
import { useUserStore } from '@/lib/store/user-store';
import { DEV_BYPASS_AUTH, DEV_FAKE_PROFILE } from '@/lib/dev/dev-bypass';

/** Map the backend user onto the auth store and the profile store. */
export function applyAuthUser(user: AuthUser): void {
  useAuthStore.getState().setSession({
    id: user.id,
    name: user.name ?? undefined,
    email: user.email,
  });
  useUserStore.getState().setProfile({
    userId: user.id,
    firstName: null,
    lastName: null,
    fullName: user.name,
    email: user.email,
    isAdmin: user.isAdmin,
    avatarUrl: null,
    hasLoggedIn: true,
  });
  useUserStore.getState().setInitialized(true);
}

/** Clear both stores (local state only — does not call the backend). */
export function clearSession(): void {
  useAuthStore.getState().setSession(null);
  useUserStore.getState().clearProfile();
}

/**
 * App-mount auth bootstrap. Dev-bypass seeds a fake session; otherwise probe
 * GET /auth/me. Always flips isHydrated so the route guards can proceed.
 */
export async function hydrateSession(): Promise<void> {
  const auth = useAuthStore.getState();
  if (auth.isHydrated) return;

  if (DEV_BYPASS_AUTH) {
    auth.setSession({
      id: DEV_FAKE_PROFILE.userId,
      name: DEV_FAKE_PROFILE.fullName,
      email: DEV_FAKE_PROFILE.email,
    });
    useUserStore.getState().setProfile({ ...DEV_FAKE_PROFILE });
    useUserStore.getState().setInitialized(true);
    auth.setHydrated(true);
    return;
  }

  const user = await AuthApi.getMe();
  if (user) {
    applyAuthUser(user);
  } else {
    clearSession();
  }
  useAuthStore.getState().setHydrated(true);
}

/** User-initiated sign-out: end the server session, clear local state, navigate. */
export async function signOut(): Promise<void> {
  try {
    await AuthApi.logout();
  } catch {
    // Session may already be gone; clear locally regardless.
  }
  clearSession();
  logoutFromWorkspaceMenu(); // existing nav/electron handling + auth-store.logout()
}
```

- [ ] **Step 6: Point the hydrator at the session bootstrap**

Replace the entire contents of `frontend/lib/store/auth-hydrator.tsx` with:

```tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  LOGIN_NAVIGATION_EVENT,
  ELECTRON_SERVER_URL_NAVIGATION_EVENT,
} from './auth-store';
import { hydrateSession } from '@/lib/auth/session';
import { isElectron } from '@/lib/electron';

/**
 * Client-only component mounted near the root of every layout (public + main).
 * Probes the session on mount (GET /auth/me) so `isHydrated` flips to `true`
 * and downstream gates (AuthGuard, GuestGuard) can proceed.
 *
 * Electron-only: soft-navigation handlers for logout / server-URL flows. Web
 * logout uses `window.location.href` (see logoutAndRedirect in auth-store.ts).
 */
export function AuthHydrator(): null {
  const router = useRouter();

  useEffect(() => {
    void hydrateSession();
  }, []);

  useEffect(() => {
    if (!isElectron()) return;
    const goLogin = () => router.replace('/login');
    const goElectronServerUrl = () => router.replace('/chat/');
    window.addEventListener(LOGIN_NAVIGATION_EVENT, goLogin);
    window.addEventListener(ELECTRON_SERVER_URL_NAVIGATION_EVENT, goElectronServerUrl);
    return () => {
      window.removeEventListener(LOGIN_NAVIGATION_EVENT, goLogin);
      window.removeEventListener(ELECTRON_SERVER_URL_NAVIGATION_EVENT, goElectronServerUrl);
    };
  }, [router]);

  return null;
}
```

- [ ] **Step 7: Rewrite the auth-actions hook to password-only**

Replace the entire contents of `frontend/app/(public)/hooks/use-auth-actions.ts` with:

```ts
'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AuthApi } from '../api';
import { applyAuthUser } from '@/lib/auth/session';

export interface AuthError {
  type: 'wrongPassword' | 'generic';
  message?: string;
}

export interface UseAuthActionsOptions {
  /** Current email entered in the form. */
  email: string;
  /** Optional post-auth redirect destination. */
  redirectTo?: string;
}

/**
 * useAuthActions — email + password sign-in against the session backend.
 * On success the backend sets the session cookie and returns the user, which we
 * map into the auth + profile stores before redirecting.
 */
export function useAuthActions({ email, redirectTo }: UseAuthActionsOptions) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);

  const postAuthRedirectTo = redirectTo || '/chat';
  const clearError = useCallback(() => setError(null), []);

  const signInWithPassword = useCallback(
    async (password: string) => {
      if (loading || !password) return;
      setLoading(true);
      setError(null);
      try {
        const user = await AuthApi.login(email.trim(), password);
        applyAuthUser(user);
        if (typeof window !== 'undefined') {
          localStorage.setItem('pipeshub_last_email', email.trim());
        }
        router.push(postAuthRedirectTo);
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 401) {
          setError({ type: 'wrongPassword' });
        } else {
          setError({ type: 'generic', message: 'Sign in failed. Please try again.' });
        }
      } finally {
        setLoading(false);
      }
    },
    [email, loading, postAuthRedirectTo, router],
  );

  return { signInWithPassword, clearError, loading, error };
}
```

> Note: the `pipeshub_last_email` localStorage key is left as-is (de-branding is a separate task); do not rename it here.

- [ ] **Step 8: Update the login form's error handling**

In `frontend/app/(public)/forms/single-provider.tsx`, replace the `inlinePasswordError` block (it currently references `'noPasswordSet'`, which no longer exists in the `AuthError` union) with:

```tsx
  const inlinePasswordError =
    passwordRequiredError ||
    (auth.error?.type === 'wrongPassword'
      ? t('auth.common.incorrectPassword')
      : undefined);
```

Leave the rest of the file unchanged (the `auth.error?.type === 'generic'` callout still applies).

- [ ] **Step 9: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: exits 0. (`hydrate-user.ts` and `token-refresh-scheduler.ts` are now unreferenced but still compile; they are deleted in the deferred purge.)

- [ ] **Step 10: Commit**

```bash
git add frontend/app/\(public\)/api.ts frontend/lib/auth/session.ts frontend/lib/store/auth-store.ts frontend/lib/dev/dev-bypass.ts frontend/lib/store/auth-hydrator.tsx frontend/app/\(public\)/hooks/use-auth-actions.ts frontend/app/\(public\)/forms/single-provider.tsx
git commit -m "Wire login form to session-based auth backend"
```

---

## Task 3: Drive the user profile from /auth/me (Decision A)

The profile store is now populated by `applyAuthUser` (on login and on `hydrateSession`). The old `UserProfileInitializer` fetches three `/api/v1/users/*` endpoints that 404 against the new backend, so neutralize it.

**Files:**
- Modify: `frontend/app/(main)/components/user-profile-initializer.tsx`

**Interfaces:**
- Consumes: nothing new. Produces: a no-op component (profile lifecycle now owned by `session.ts`).

- [ ] **Step 1: Make the initializer a no-op**

Replace the entire contents of `frontend/app/(main)/components/user-profile-initializer.tsx` with:

```tsx
'use client';

/**
 * UserProfileInitializer
 *
 * The user profile is now populated from GET /auth/me by lib/auth/session.ts
 * (applyAuthUser, on login and on app-mount hydration) and cleared by signOut.
 * This component is retained as a mount point in the (main) layout but performs
 * no work — the legacy /api/v1/users/* fetches it used to run do not exist on
 * the session backend.
 */
export function UserProfileInitializer() {
  return null;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: exits 0. (`use-initialize-user-profile.ts` is now unreferenced but still compiles; deleted in the deferred purge.)

- [ ] **Step 3: Commit**

```bash
git add frontend/app/\(main\)/components/user-profile-initializer.tsx
git commit -m "Drive user profile from /auth/me instead of dead user endpoints"
```

---

## Task 4: Route logout through the session backend

Repoint the two logout callers to `signOut` (which calls the backend, clears both stores, then navigates) instead of the local-only `logoutFromWorkspaceMenu`.

**Files:**
- Modify: `frontend/app/components/workspace-menu/menu.tsx`
- Modify: `frontend/app/(main)/workspace/profile/hooks/use-profile-page.ts`

**Interfaces:**
- Consumes: `signOut` from `@/lib/auth/session` (Task 2).

- [ ] **Step 1: Update the workspace menu**

In `frontend/app/components/workspace-menu/menu.tsx`:
- Change the import (line 5) from `import { logoutFromWorkspaceMenu } from '@/lib/store/auth-store';` to `import { signOut } from '@/lib/auth/session';`
- Change the call site (line ~118) from `logoutFromWorkspaceMenu();` to `void signOut();`

- [ ] **Step 2: Update the profile-page hook**

In `frontend/app/(main)/workspace/profile/hooks/use-profile-page.ts`:
- Change the import (line 6) from `import { logoutFromWorkspaceMenu } from '@/lib/store/auth-store';` to `import { signOut } from '@/lib/auth/session';`
- Change the call site (line ~157) from `logoutFromWorkspaceMenu();` to `void signOut();`

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: exits 0. (`logoutFromWorkspaceMenu` remains exported from auth-store and is still used internally by `signOut`.)

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/workspace-menu/menu.tsx frontend/app/\(main\)/workspace/profile/hooks/use-profile-page.ts
git commit -m "Route logout through the session backend"
```

---

## Task 5: Manual end-to-end verification

No code unless a defect is found. With the backend running (Prerequisites) and `frontend/.env.local` pointing at `:4000` with `NEXT_PUBLIC_DEV_BYPASS_AUTH=0`, run `cd frontend && npm run dev` and verify each success criterion.

- [ ] **Step 1: Wrong password shows inline error**
Go to `http://localhost:3000/login`, enter the admin email + a wrong password, submit. Expected: inline "incorrect password" message, no redirect, no error toast.

- [ ] **Step 2: Valid login lands on /chat**
Enter the correct admin email + password. Expected: redirect to `/chat`; the workspace menu shows the admin's name. In DevTools → Application → Cookies, a `connect.sid` cookie exists for `localhost`.

- [ ] **Step 3: Session survives refresh**
Hard-refresh `/chat`. Expected: stays authenticated (no bounce to `/login`); `GET /auth/me` returns 200 in the Network tab.

- [ ] **Step 4: Admin status resolves**
Confirm any admin-only nav/UI appears (profile `isAdmin` is true for an admin account).

- [ ] **Step 5: Logout ends the session**
Use the workspace menu → Logout. Expected: redirect to `/login`; a `POST /auth/logout` returns 204; navigating back to `/chat` bounces to `/login`; a subsequent `GET /auth/me` returns 401.

- [ ] **Step 6: Guest guard**
While logged out, visit `/chat` directly. Expected: redirect to `/login`. While logged in, visit `/login`. Expected: redirect to `/chat`.

- [ ] **Step 7: Dev bypass still works (Decision B)**
Set `NEXT_PUBLIC_DEV_BYPASS_AUTH=1` in `.env.local`, restart `npm run dev`, visit `/chat`. Expected: authenticated shell renders with the "Dev User" profile and no backend calls for auth. Restore to `0` afterward.

> If all steps pass, the slice is complete. If a step fails, debug with the systematic-debugging skill; any fix is its own small commit using the plain message style.

---

## Self-Review (completed during planning)

- **Spec coverage:** §1 base URL → Prereqs; §2 auth API → Task 2/1; §3 CSRF → Task 1/1–2; §4 axios → Task 1/2; §5 store → Task 2/2–3; §6 hydration → Task 2/5–6; §7 login form → Task 2/7–8; §8 logout → Task 4; §9 Decision A → Task 3; §10 trim → Task 2 (api.ts + use-auth-actions rewrites); §11 Decision B → Task 2/4–5 (dev seeding moved into `hydrateSession`); testing → Task 5.
- **Scope deviation (noted to user):** spec §10 listed deleting `token-refresh.ts`, `token-refresh-scheduler.ts`, `post-user-account-authenticate.ts`. These are shared with `streaming.ts` / workspace settings, so they are **disconnected from the login path here and physically deleted in the deferred purge** — kept within #1's "defer app-wide token plumbing" boundary. `hydrate-user.ts` and `use-initialize-user-profile.ts` likewise become unreferenced and are deleted later.
- **Type consistency:** `AuthUser` (api.ts) → `applyAuthUser` maps `name` (`string | null`) to store `User.name` via `?? undefined`, and to `UserProfile.fullName` (`string | null`) directly; `isAdmin` (`boolean`) → `UserProfile.isAdmin` (`boolean | null`). `AuthError` union reduced to `'wrongPassword' | 'generic'` and the only consumer (`single-provider.tsx`) updated to match. `skipAuthRedirect` declared in Task 1, consumed in Task 2.
- **Placeholder scan:** none.
