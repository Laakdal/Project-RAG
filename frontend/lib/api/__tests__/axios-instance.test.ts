import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';

// Keep the interceptor's heavy collaborators inert so we exercise only the
// request/response interceptor logic.
vi.mock('@/lib/store/auth-store', () => ({ logoutAndRedirect: vi.fn() }));
vi.mock('@/lib/api/error-toast', () => ({ showErrorToast: vi.fn() }));
vi.mock('@/lib/utils/api-base-url', () => ({ getApiBaseUrl: () => '' }));
vi.mock('@/lib/electron', () => ({ applyElectronOverrides: vi.fn() }));
vi.mock('../api-error', () => ({ processError: (e: unknown) => e }));

import apiClient from '../axios-instance';
import { showErrorToast } from '../error-toast';
import { CSRF_HEADER_NAME } from '../csrf';

function headerCsrf(config: InternalAxiosRequestConfig): string | undefined {
  const h = config.headers as unknown as {
    get?: (n: string) => unknown;
    [k: string]: unknown;
  };
  const v = h.get ? h.get(CSRF_HEADER_NAME) : h[CSRF_HEADER_NAME];
  return v == null ? undefined : String(v);
}

// A custom axios adapter is responsible for enforcing validateStatus itself, so
// mirror real behaviour: resolve on 2xx, reject with an AxiosError otherwise.
function respond(
  config: InternalAxiosRequestConfig,
  status: number,
  data: unknown,
): Promise<AxiosResponse> {
  const response = {
    data,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {},
    config,
  } as AxiosResponse;
  if (status >= 200 && status < 300) return Promise.resolve(response);
  return Promise.reject(
    new AxiosError(
      `Request failed with status code ${status}`,
      status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST',
      config,
      null,
      response,
    ),
  );
}

type Seen = { url?: string; csrf?: string };

describe('axios 403 Invalid CSRF auto-recovery', () => {
  beforeEach(() => {
    // No readable cookie — forces the body-token (cross-origin) path.
    Object.defineProperty(document, 'cookie', { writable: true, value: '' });
    vi.clearAllMocks();
  });
  afterEach(() => {
    delete (apiClient.defaults as { adapter?: unknown }).adapter;
  });

  it('re-seeds the CSRF cookie and retries the original request once, silently', async () => {
    const seen: Seen[] = [];
    let chatCalls = 0;
    apiClient.defaults.adapter = async (config) => {
      seen.push({ url: config.url, csrf: headerCsrf(config) });
      if (config.url === '/auth/csrf') {
        return respond(config, 200, { csrfToken: 'fresh-token' });
      }
      chatCalls += 1;
      if (chatCalls === 1) {
        return respond(config, 403, { error: 'Invalid CSRF token' });
      }
      return respond(config, 200, { ok: true });
    };

    const res = await apiClient.post('/chat/send', { q: 'hi' });

    expect(res.data).toEqual({ ok: true });
    expect(seen.some((s) => s.url === '/auth/csrf')).toBe(true);

    const chats = seen.filter((s) => s.url === '/chat/send');
    expect(chats).toHaveLength(2); // original + one retry
    expect(chats[1].csrf).toBe('fresh-token'); // retry carried the fresh token
    expect(showErrorToast).not.toHaveBeenCalled(); // healed silently
  });

  it('retries at most once, then surfaces the error (no infinite loop)', async () => {
    let chatCalls = 0;
    apiClient.defaults.adapter = async (config) => {
      if (config.url === '/auth/csrf') {
        return respond(config, 200, { csrfToken: 'fresh-token' });
      }
      chatCalls += 1;
      return respond(config, 403, { error: 'Invalid CSRF token' });
    };

    await expect(apiClient.post('/chat/send', { q: 'hi' })).rejects.toBeTruthy();
    expect(chatCalls).toBe(2); // original + exactly one retry
    expect(showErrorToast).toHaveBeenCalledTimes(1); // toasts once after retry fails
  });
});
