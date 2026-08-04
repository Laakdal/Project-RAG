'use client';

import { useEffect } from 'react';
import { hydrateSession } from '@/lib/auth/session';

/**
 * Client-only component mounted near the root of every layout (public + main).
 * Probes the session on mount (GET /auth/me) so `isHydrated` flips to `true`
 * and downstream gates (AuthGuard, GuestGuard) can proceed.
 */
export function AuthHydrator(): null {
  useEffect(() => {
    void hydrateSession();
  }, []);

  return null;
}
