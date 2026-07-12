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
    // Seed/refresh the CSRF cookie on every authenticated mount, not just at
    // login. The cookie has a shorter lifetime than the session, so on a reload
    // after it expired the session is still valid but mutating calls (e.g.
    // sending a chat) would 403 with "Invalid CSRF token". Best-effort — never
    // block hydration on it; the 403 auto-retry in the axios interceptor is the
    // backstop if this fails.
    try {
      await AuthApi.getCsrf();
    } catch {
      // Non-fatal.
    }
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
