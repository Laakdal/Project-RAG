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
