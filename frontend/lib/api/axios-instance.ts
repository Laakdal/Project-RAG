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

    // FormData uploads must NOT carry the instance default
    // `Content-Type: application/json`. Delete it so the browser sets
    // `multipart/form-data` with its boundary — otherwise the server (multer)
    // can't parse the file and the upload looks like an empty request.
    if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
      config.headers.delete('Content-Type');
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
