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
