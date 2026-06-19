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
