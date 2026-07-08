import { apiClient } from '@/lib/api';
import { useChatStore } from './store';

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

export async function askQuestion(
  conversationId: string,
  question: string,
  useLibrary = false,
): Promise<{ answer: string; sources: Source[] }> {
  const { data } = await apiClient.post(
    `/chat/conversations/${conversationId}/messages`,
    useLibrary ? { question, useLibrary: true } : { question },
  );
  return data;
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
