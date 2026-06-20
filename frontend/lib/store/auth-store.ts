import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { isElectron } from '@/lib/electron';
import {
  clearElectronLogoutServerState,
  persistElectronServerUrlOnLogin,
} from '@/lib/electron/api-base-url-storage';

export interface User {
  id: string;
  phone?: string;
  name?: string;
  email?: string;
  created_at?: string;
  updated_at?: string;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  isAuthenticated: boolean;
  isHydrated: boolean;
}

interface AuthActions {
  setTokens: (accessToken: string, refreshToken: string) => void;
  setAccessToken: (accessToken: string) => void;
  setUser: (user: User | null) => void;
  setSession: (user: User | null) => void;
  logout: () => void;
  setHydrated: (value: boolean) => void;
}

type AuthStore = AuthState & AuthActions;

/** localStorage keys (shared with the legacy frontend so tokens interop). */
export const ACCESS_TOKEN_STORAGE_KEY = 'jwt_access_token';
export const REFRESH_TOKEN_STORAGE_KEY = 'jwt_refresh_token'; 

const initialState: AuthState = {
  accessToken: null,
  refreshToken: null,
  user: null,
  isAuthenticated: false,
  isHydrated: false,
};

function writeAccessToken(accessToken: string | null): void {
  if (typeof window === 'undefined') return;
  if (accessToken) {
    window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, accessToken);
  } else {
    window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  }
}

function writeRefreshToken(refreshToken: string | null): void {
  if (typeof window === 'undefined') return;
  if (refreshToken) {
    window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, refreshToken);
  } else {
    window.localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  }
}

export const useAuthStore = create<AuthStore>()(
  devtools(
    immer((set) => ({
      ...initialState,

      setTokens: (accessToken, refreshToken) => {
        writeAccessToken(accessToken);
        writeRefreshToken(refreshToken);
        persistElectronServerUrlOnLogin();
        set((state) => {
          state.accessToken = accessToken;
          state.refreshToken = refreshToken;
          state.isAuthenticated = true;
        });
      },

      setAccessToken: (accessToken) => {
        writeAccessToken(accessToken);
        set((state) => {
          state.accessToken = accessToken;
          state.isAuthenticated = !!accessToken;
        });
      },

      setUser: (user) =>
        set((state) => {
          state.user = user;
        }),

      setSession: (user) =>
        set((state) => {
          state.user = user;
          state.isAuthenticated = !!user;
        }),

      logout: () => {
        writeAccessToken(null);
        writeRefreshToken(null);
        set((state) => {
          state.accessToken = null;
          state.refreshToken = null;
          state.user = null;
          state.isAuthenticated = false;
        });
      },

      setHydrated: (value) =>
        set((state) => {
          state.isHydrated = value;
        }),
    })),
    { name: 'AuthStore' }
  )
);

/** Dispatched after logout; AuthHydrator listens and runs client-side navigation. */
export const LOGIN_NAVIGATION_EVENT = 'request-login-navigation';

/** Electron: after explicit workspace logout, show server URL screen then sign-in (see AuthHydrator). */
export const ELECTRON_SERVER_URL_NAVIGATION_EVENT = 'electron-goto-server-url-flow';

/**
 * Clears all auth state and redirects the user to the login page.
 * Single source of truth used by the axios interceptor (session expiry / 401).
 *
 * Web: hard navigation via `window.location.href = '/login'` (original behavior).
 * Electron: dispatch a CustomEvent that AuthHydrator consumes to do a soft
 * `router.replace('/login')` — a hard navigation under `app://` reloads into an
 * empty shell.
 */
export function logoutAndRedirect(): void {
  useAuthStore.getState().logout();
  if (typeof window === 'undefined') return;
  if (isElectron()) {
    window.dispatchEvent(new CustomEvent(LOGIN_NAVIGATION_EVENT));
    return;
  }
  window.location.href = '/login';
}

/**
 * Workspace menu logout: web → same as session-expiry logout; Electron → clear
 * server URL ack (keep last URL for pre-fill), then route through ServerUrlGuard's
 * add-URL screen so the user can confirm or change the server before signing in.
 */
export function logoutFromWorkspaceMenu(): void {
  if (typeof window !== 'undefined' && isElectron()) {
    useAuthStore.getState().logout();
    clearElectronLogoutServerState();
    window.dispatchEvent(new CustomEvent(ELECTRON_SERVER_URL_NAVIGATION_EVENT));
    return;
  }
  // Web path is identical to the 401 / session-expiry flow — delegate so the
  // two paths stay in lockstep.
  logoutAndRedirect();
}

// Selectors for common access patterns
export const selectAccessToken = (state: AuthStore) => state.accessToken;
export const selectRefreshToken = (state: AuthStore) => state.refreshToken;
export const selectUser = (state: AuthStore) => state.user;
export const selectIsAuthenticated = (state: AuthStore) => state.isAuthenticated;
export const selectIsHydrated = (state: AuthStore) => state.isHydrated;
