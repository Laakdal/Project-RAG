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
// Must exceed the backend's n8n query timeout (150s) so a slow first-time
// on-demand Drive read completes instead of the client aborting early and
// discarding an answer the backend already has in flight.
const API_TIMEOUT = 160_000;

const MUTATING_METHODS = new Set(['post', 'put', 'patch', 'delete']);

// Next.js (trailingSlash: true) answers any API path WITHOUT a trailing slash
// with a 308 redirect to the slash version. For a GET that's a wasted round
// trip; for a large multipart POST it makes the browser RE-SEND the entire body
// to the slash URL — a 20 MB upload gets uploaded twice (and buffered to disk at
// each proxy hop), which stalls and times out. Normalizing every request to the
// trailing-slash path up front means the redirect never fires. The Express
// backend matches both `/x` and `/x/`, so this is safe for every endpoint; the
// slash is inserted before the query/hash so `/x?q=1` becomes `/x/?q=1`.
function ensureTrailingSlashPath(url?: string): string | undefined {
  if (!url) return url;
  const splitAt = url.search(/[?#]/);
  const path = splitAt === -1 ? url : url.slice(0, splitAt);
  const suffix = splitAt === -1 ? '' : url.slice(splitAt);
  return path.endsWith('/') ? url : `${path}/${suffix}`;
}

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

    // FormData uploads must NOT carry the instance default
    // `Content-Type: application/json`. Delete it so the browser sets
    // `multipart/form-data` with its boundary — otherwise the server (multer)
    // can't parse the file and the upload looks like an empty request.
    if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
      config.headers.delete('Content-Type');
    }

    // Avoid the Next.js trailing-slash 308 redirect (see helper above) — critical
    // for large uploads, which would otherwise send the whole body twice.
    config.url = ensureTrailingSlashPath(config.url);
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

    const originalRequest = error.config as
      | (InternalAxiosRequestConfig & { _csrfRetried?: boolean })
      | undefined;

    if (error.response?.status === 401) {
      if (!originalRequest?.skipAuthRedirect) {
        logoutAndRedirect();
      }
      return Promise.reject(processError(error));
    }

    // A 403 "Invalid CSRF token" means our `csrf_token` cookie was missing or
    // stale (it expires before the session, and is only seeded at login/mount).
    // Re-seed it via GET /auth/csrf, then retry the original request ONCE. This
    // heals silently — no toast, no lost message — for the common expired-cookie
    // case. Capture the token from the response body too so it works even
    // cross-origin, where JS can't read the API origin's cookie.
    const csrfFailed =
      error.response?.status === 403 &&
      (error.response?.data as { error?: string } | undefined)?.error ===
        'Invalid CSRF token';
    if (csrfFailed && originalRequest && !originalRequest._csrfRetried) {
      originalRequest._csrfRetried = true;
      try {
        const { data } = await apiClient.get<{ csrfToken: string }>('/auth/csrf', {
          skipAuthRedirect: true,
          suppressErrorToast: true,
        });
        if (data?.csrfToken && originalRequest.headers) {
          originalRequest.headers.set(CSRF_HEADER_NAME, data.csrfToken);
        }
      } catch {
        // Re-seed failed; fall through to retry anyway (the request interceptor
        // will still attach the cookie value if one is now present).
      }
      return apiClient(originalRequest);
    }

    // The legacy `/api/v1/*` surface (model list, speech, old conversation
    // detail, etc.) is not wired up in the RAG deployment — those routes are
    // unproxied, so Next.js answers them with its own 404. They're harmless
    // leftovers from the adapted UI, so don't surface a scary "Not Found" toast
    // for them; real errors on the live `/chat` and `/auth` routes still toast.
    const requestUrl = originalRequest?.url ?? '';
    const isDeadLegacyEndpoint =
      error.response?.status === 404 && requestUrl.includes('/api/v1/');

    const processedError = processError(error);
    if (!originalRequest?.suppressErrorToast && !isDeadLegacyEndpoint) {
      showErrorToast(processedError);
    }
    return Promise.reject(processedError);
  },
);

export { apiClient as default };
