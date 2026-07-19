import { apiClient } from '@/lib/api';
import { readCsrfCookie, CSRF_HEADER_NAME } from '@/lib/api/csrf';
import { useChatStore } from './store';

// Same-origin by default; overridden at build time for split deployments. Mirrors
// the axios instance / streaming module so the SSE call reaches the same backend.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

export interface Source {
  filename: string;
  chunkIndex: number;
  text: string;
  /** Present for library results — links the citation to the Drive doc. */
  webUrl?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: Source[] | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
}

export interface ChatAttachment {
  id: string;
  filename: string;
  status: string;
  chunkCount: number | null;
  /** True when the original file is stored server-side and can be opened. */
  hasFile?: boolean;
  createdAt: string;
}

/** List the documents already ingested into a conversation (persisted server-side). */
export async function listAttachments(
  conversationId: string,
): Promise<ChatAttachment[]> {
  const { data } = await apiClient.get<ChatAttachment[]>(
    `/chat/conversations/${conversationId}/attachments`,
    // Best-effort: the persistent chip is a nice-to-have, so never surface a
    // toast if this endpoint is unavailable (e.g. an older backend). The caller
    // catches and falls back to an empty list.
    { suppressErrorToast: true },
  );
  return data;
}

export async function createConversation(): Promise<Conversation> {
  const { data } = await apiClient.post<Conversation>('/chat/conversations', {});
  return data;
}

export async function listConversations(): Promise<Conversation[]> {
  const { data } = await apiClient.get<Conversation[]>('/chat/conversations');
  return data;
}

export async function listMessages(conversationId: string): Promise<ChatMessage[]> {
  const { data } = await apiClient.get<ChatMessage[]>(
    `/chat/conversations/${conversationId}/messages`,
  );
  return data;
}

export async function uploadAttachment(
  conversationId: string,
  file: File,
  signal?: AbortSignal,
): Promise<{ attachmentId: string; status: string; chunkCount: number }> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await apiClient.post(
    `/chat/conversations/${conversationId}/attachments`,
    form,
    // A large file over a slow uplink can take minutes; the default 90s timeout
    // would abort it. Scope a long timeout to this upload only (other calls keep
    // the default). Must be paired with `experimental.proxyTimeout` in
    // next.config.mjs, which caps the Next→backend proxy leg.
    { signal, timeout: 600_000 },
  );
  return data;
}

/**
 * Detach + delete a persisted attachment from a conversation. Best-effort and
 * fire-and-forget: the caller removes the chip optimistically and refreshes the
 * list afterwards, so a failed delete must never surface a toast or reject. All
 * errors are swallowed here.
 */
export async function deleteAttachment(
  conversationId: string,
  attachmentId: string,
): Promise<void> {
  try {
    await apiClient.delete(
      `/chat/conversations/${conversationId}/attachments/${attachmentId}`,
      { suppressErrorToast: true },
    );
  } catch {
    // Swallow: an orphan record is acceptable; the optimistic removal +
    // refresh in the caller keeps the UI honest.
  }
}

export async function deleteConversation(conversationId: string): Promise<void> {
  await apiClient.delete(`/chat/conversations/${conversationId}`);
}

export async function renameConversation(
  conversationId: string,
  title: string,
): Promise<void> {
  await apiClient.patch(`/chat/conversations/${conversationId}`, { title });
}

/**
 * Thrown when the backend answers a message send with HTTP 202 `{status:"reading"}`
 * — an attached file is still being read (extracted). The caller retries after a
 * short delay until the read finishes (or gives up), showing a progress hint.
 */
export class AttachmentReadingError extends Error {
  constructor() {
    super('attachment still reading');
    this.name = 'AttachmentReadingError';
  }
}

export async function askQuestion(
  conversationId: string,
  question: string,
  useLibrary = false,
): Promise<{ answer: string; sources: Source[] }> {
  const { data } = await apiClient.post(
    `/chat/conversations/${conversationId}/messages`,
    useLibrary ? { question, useLibrary: true } : { question },
  );
  // 202 "reading": the attachment read is still in progress. Signal the caller
  // to retry rather than treating the empty body as a (missing) answer.
  const pending = data as { status?: string; answer?: unknown };
  if (pending && pending.status === 'reading' && pending.answer === undefined) {
    throw new AttachmentReadingError();
  }
  return data;
}

/** One reported pipeline step during a streaming ask (see backend QueryPhase). */
export interface AskPhase {
  key: string;
  label: string;
}

/**
 * Ask a question over an SSE stream so the UI can show real pipeline progress
 * ("searching your documents", "reading Drive", "writing the answer") as the
 * backend graph runs, then resolve with the final `{ answer, sources }`.
 *
 * Auth is the httpOnly session cookie (sent via `credentials: 'include'`), so we
 * attach the double-submit CSRF header ourselves — native fetch bypasses the
 * axios interceptor that normally does this. A 403 (expired csrf cookie) is
 * healed once by re-seeding via GET /auth/csrf, mirroring the axios retry.
 *
 * Falls back to the non-streaming `askQuestion` when the stream endpoint is
 * unavailable (404/405), so the same client works against an older backend.
 */
export async function askQuestionStreaming(
  conversationId: string,
  question: string,
  handlers: {
    onPhase?: (phase: AskPhase) => void;
    /** Called with each answer-token delta as the model writes the reply. */
    onToken?: (text: string) => void;
    signal?: AbortSignal;
  },
  useLibrary = false,
): Promise<{ answer: string; sources: Source[] }> {
  const url = `${API_BASE_URL}/chat/conversations/${conversationId}/messages/stream`;
  const body = JSON.stringify(useLibrary ? { question, useLibrary: true } : { question });

  const doFetch = () => {
    const csrf = readCsrfCookie();
    return fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(csrf ? { [CSRF_HEADER_NAME]: csrf } : {}),
      },
      body,
      signal: handlers.signal,
    });
  };

  let response = await doFetch();
  // Re-seed a stale CSRF cookie once, then retry (matches the axios interceptor).
  if (response.status === 403) {
    try {
      await apiClient.get('/auth/csrf', { suppressErrorToast: true });
    } catch {
      // Fall through: retry anyway; the interceptor may have set a cookie.
    }
    response = await doFetch();
  }

  // Older backend without the stream route → use the plain JSON endpoint.
  if (response.status === 404 || response.status === 405) {
    return askQuestion(conversationId, question, useLibrary);
  }
  if (!response.ok || !response.body) {
    throw new Error(`Stream request failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: { answer: string; sources: Source[] } | null = null;
  let errorMessage: string | null = null;

  const handleEvent = (event: string, dataStr: string) => {
    let data: unknown;
    try {
      data = JSON.parse(dataStr);
    } catch {
      return;
    }
    if (event === 'phase') {
      handlers.onPhase?.(data as AskPhase);
    } else if (event === 'token') {
      const text = (data as { text?: string }).text;
      if (text) handlers.onToken?.(text);
    } else if (event === 'done') {
      result = data as { answer: string; sources: Source[] };
    } else if (event === 'error') {
      errorMessage = (data as { message?: string }).message ?? 'An error occurred.';
    }
  };

  // Parse whole SSE events out of the buffer (events are separated by a blank
  // line); keep any trailing partial event for the next chunk.
  const drainBuffer = () => {
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      let event = 'message';
      let dataStr = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
      }
      if (dataStr) handleEvent(event, dataStr);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    drainBuffer();
  }
  buffer += decoder.decode();
  drainBuffer();

  if (errorMessage) throw new Error(errorMessage);
  if (!result) throw new Error('The stream ended without an answer.');
  return result;
}

/**
 * Regenerate the latest assistant answer: the backend re-runs the query for the
 * last user question and overwrites that assistant message in place, returning
 * the new `{ answer, sources }`. The caller swaps the answer into the slot so the
 * existing bubble is replaced (no new turn appended).
 */
export async function regenerateAnswer(
  conversationId: string,
): Promise<{ answer: string; sources: Source[] }> {
  const { data } = await apiClient.post(
    `/chat/conversations/${conversationId}/messages/regenerate`,
    {},
  );
  return data;
}

/**
 * In-flight `createConversation` promises keyed by slot id. Dedupes concurrent
 * conversation creates for the same slot — e.g. a drop-file (upload) and an
 * immediate send both racing to create a conversation would otherwise spawn two.
 */
const inFlightConversationCreates = new Map<string, Promise<string>>();

/**
 * Idempotent, race-free "ensure the slot has a conversation id".
 *
 * - If the slot already has a `convId`, returns it immediately.
 * - Otherwise dedupes concurrent creates via a module-level in-flight cache:
 *   the first caller starts the create, resolves the new id onto the slot via
 *   `resolveSlotConvId`, and any concurrent caller awaits the same promise.
 *
 * Used by both the send path (`onNew`) and the upload path (`handleUploadFile`)
 * so a single conversation backs both.
 */
export async function ensureSlotConversation(
  slotId: string,
  opts?: { keepTemp?: boolean },
): Promise<string> {
  // The upload path passes keepTemp so creating a conversation for an attachment
  // does NOT flip the slot out of the centered "new chat" view (which would
  // remount the composer and drop the upload chip). The send path leaves it
  // unset so the first message commits the chat to a real conversation.
  const keepTemp = opts?.keepTemp === true;
  const existing = useChatStore.getState().slots[slotId]?.convId ?? null;
  if (existing) return existing;

  const pending = inFlightConversationCreates.get(slotId);
  if (pending) return pending;

  const createPromise = (async () => {
    const conv = await createConversation();
    useChatStore.getState().resolveSlotConvId(slotId, conv.id, { keepTemp });
    return conv.id;
  })().finally(() => {
    inFlightConversationCreates.delete(slotId);
  });

  inFlightConversationCreates.set(slotId, createPromise);
  return createPromise;
}
