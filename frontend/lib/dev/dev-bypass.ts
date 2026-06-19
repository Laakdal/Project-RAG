'use client';

/**
 * DEV-ONLY login/health bypass.
 *
 * Enable by setting `NEXT_PUBLIC_DEV_BYPASS_AUTH=1` in `.env.local` (and
 * restarting the dev server). When on, the app seeds a fake authenticated
 * session + user profile and skips the "waiting for server" health gate, so
 * the authenticated UI (chat, collections, sidebar) can be viewed WITHOUT a
 * backend. Data-fetching APIs still fail — pages render their empty/loading
 * states. This is purely a visual preview aid.
 *
 * It is gated behind an env flag that is only ever set in `.env.local`
 * (gitignored). Production / Docker builds never set it, so the bypass is a
 * no-op there. Remove this file + its references once a real backend exists.
 */
export const DEV_BYPASS_AUTH = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === '1';

export const DEV_FAKE_PROFILE = {
  userId: 'dev-user',
  firstName: 'Dev',
  lastName: 'User',
  fullName: 'Dev User',
  email: 'dev@local',
  isAdmin: true as boolean | null,
  avatarUrl: null as string | null,
  hasLoggedIn: true,
};
