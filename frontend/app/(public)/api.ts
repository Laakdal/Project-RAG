import { apiClient } from '@/lib/api';
import { CSRF_HEADER_NAME } from '@/lib/api/csrf';

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
  // Send the CSRF token explicitly in the header, taken from the /auth/csrf
  // response body (not the cookie). This works cross-site too, where a localhost
  // page cannot read the API origin's cookie.
  const csrfToken = await getCsrf();
  const { data } = await apiClient.post<AuthUser>(
    '/auth/login',
    { email, password },
    { ...AUTH_REQUEST_CONFIG, headers: { [CSRF_HEADER_NAME]: csrfToken } },
  );
  return data;
}

/** End the session server-side. */
async function logout(): Promise<void> {
  const csrfToken = await getCsrf();
  await apiClient.post('/auth/logout', undefined, {
    ...AUTH_REQUEST_CONFIG,
    headers: { [CSRF_HEADER_NAME]: csrfToken },
  });
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
