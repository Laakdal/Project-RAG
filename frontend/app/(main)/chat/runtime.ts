/**
 * External Store Runtime bridge for assistant-ui.
 *
 * Provides:
 * 1. `buildExternalStoreConfig(activeSlotId)` — returns the config object
 *    consumed by `useExternalStoreRuntime`. Reads `messages` and `isRunning`
 *    from the active slot; wires `onNew` and `onCancel` to streaming.ts.
 *
 * 2. `loadHistoricalMessages()` — transforms backend ConversationMessage[]
 *    into ThreadMessageLike[] (used when initializing a slot).
 */

import type { ExternalStoreAdapter } from '@assistant-ui/react';
import type { ThreadMessageLike } from '@assistant-ui/react';
import { useChatStore } from './store';
import { cancelStreamForSlot } from './streaming';
import { askQuestion, ensureSlotConversation } from './rag-api';
import {
  type AttachmentRef,
  type ChatCollectionAttachment,
  type ConversationMessage,
} from './types';
import {
  buildCitationMapsFromApi,
} from './components/message-area/response-tabs/citations';

/** Non-empty query required by the chat API when the user sends attachments only (matches Slack bot). */
const ATTACHMENT_ONLY_STREAM_QUERY = 'See below attached file(s).';

/** Stable id for the in-flight assistant placeholder (works on HTTP where randomUUID is missing). */
function createPendingAssistantId(): string {
  const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return `asst-pending-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Extract text content from assistant-ui message content
 */
function extractTextContent(content: ThreadMessageLike['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (part): part is { type: 'text'; text?: string } =>
        typeof part === 'object' && part !== null && 'type' in part && part.type === 'text'
    )
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('');
}

/** Plain text of a thread message (used by streaming + message list). */
export function getThreadMessagePlainText(message: ThreadMessageLike): string {
  return extractTextContent(message.content);
}

/** KB collections attached on send (see chat input metadata). */
function readKbCollectionsFromMessage(
  message: ThreadMessageLike
): ChatCollectionAttachment[] | undefined {
  const raw = message.metadata?.custom?.collections;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: ChatCollectionAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== 'string') continue;
    const name = (item as { name?: unknown }).name;
    const kindRaw = (item as { kind?: unknown }).kind;
    const kind =
      kindRaw === 'recordGroup' || kindRaw === 'collectionRoot'
        ? kindRaw
        : undefined;
    out.push({
      id,
      name: typeof name === 'string' ? name : '',
      ...(kind ? { kind } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Transform backend conversation messages into assistant-ui thread format.
 *
 * Builds CitationMaps from CitationApiResponse for each bot_response.
 */
export function loadHistoricalMessages(
  messages: ConversationMessage[]
): ThreadMessageLike[] {
  return messages.map((msg) => ({
    // Stable per-message id — keeps list keys and citation popovers from remounting
    // on every `messages` ref replace (e.g. SSE complete or history refresh).
    id: msg._id,
    role: msg.messageType === 'user_query' ? ('user' as const) : ('assistant' as const),
    content: [
      {
        type: 'text' as const,
        text: msg.content,
      },
    ],
    metadata:
      msg.messageType === 'bot_response'
        ? {
            custom: {
              messageId: msg._id,
              citationMaps: buildCitationMapsFromApi(msg.citations || []),
              confidence: msg.confidence,
              modelInfo: msg.modelInfo,
              // Feedback is stored server-side but intentionally not displayed in the UI
            },
          }
        : msg.messageType === 'user_query'
        ? {
            custom: {
              createdAt: msg.createdAt,
              ...(msg.appliedFilters ? { appliedFilters: msg.appliedFilters } : {}),
              ...(msg.attachments?.length ? { attachments: msg.attachments } : {}),
            },
          }
        : {
          custom: {
            createdAt: msg.createdAt,
          },
        },
  }));
}

/** Attachment refs attached on send (see chat input metadata). */
function readAttachmentsFromMessage(
  message: ThreadMessageLike
): AttachmentRef[] | undefined {
  const raw = message.metadata?.custom?.attachments;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: AttachmentRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const recordId = (item as { recordId?: unknown }).recordId;
    const virtualRecordId = (item as { virtualRecordId?: unknown }).virtualRecordId;
    if (typeof recordId !== 'string' || typeof virtualRecordId !== 'string') continue;
    out.push({
      recordId,
      recordName: String((item as { recordName?: unknown }).recordName ?? ''),
      mimeType: String((item as { mimeType?: unknown }).mimeType ?? ''),
      extension: String((item as { extension?: unknown }).extension ?? ''),
      virtualRecordId,
    });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Build the ExternalStoreAdapter config for `useExternalStoreRuntime`.
 *
 * This function is called on every render of the chat page.
 * It reads the active slot's messages + streaming state and provides
 * `onNew` / `onCancel` callbacks routed to slot-scoped streaming.
 *
 * @param activeSlotId — current active slot key (or null for new chat screen)
 */
export function buildExternalStoreConfig(
  activeSlotId: string | null
): ExternalStoreAdapter<ThreadMessageLike> {
  const state = useChatStore.getState();
  const slot = activeSlotId ? state.slots[activeSlotId] : null;

  return {
    messages: slot?.messages ?? [],
    isRunning: slot?.isStreaming ?? false,

    // Required when T = ThreadMessageLike (identity — our messages are already ThreadMessageLike)
    convertMessage: (msg: ThreadMessageLike) => msg,

    onNew: async (message) => {
      // Read activeSlotId from store at invocation time — NOT from the
      // closure. ChatInputWrapper.handleSend creates a slot and sets
      // activeSlotId synchronously in Zustand before calling
      // threadRuntime.append(), but React hasn't re-rendered yet, so
      // the closure's `activeSlotId` is still stale (null for new chats).
      const targetSlotId = useChatStore.getState().activeSlotId;
      if (!targetSlotId) return;

      const displayQuery = extractTextContent(message.content).trim();
      const msgAttachments = readAttachmentsFromMessage(message);
      if (!displayQuery && (!msgAttachments || msgAttachments.length === 0)) return;

      const store = useChatStore.getState();
      const currentSlot = store.slots[targetSlotId];
      if (!currentSlot) return;
      // Safety net: ChatInputWrapper blocks user sends while streaming; only programmatic api call `threadRuntime.append` reaches here.
      if (currentSlot.isStreaming) return;

      const apiQuery =
        displayQuery ||
        (msgAttachments && msgAttachments.length > 0
          ? ATTACHMENT_ONLY_STREAM_QUERY
          : '');
      if (!apiQuery) return;

      // A new chat has no conversation yet — we'll create one (below) so the
      // URL-sync effect (page.tsx) can push `?conversationId=<id>` and the
      // sidebar gets a row.
      const isNewConversation = currentSlot.isTemp || !currentSlot.convId;

      // ── SYNCHRONOUS store writes FIRST — before any await ──
      // Set the busy flag, append the user turn + an empty assistant placeholder,
      // and (for new chats) push the pending sidebar row. This MUST happen before
      // creating the conversation: the composer-disable signal and the re-entry
      // guard above both read `slot.isStreaming`, so if we awaited the create
      // first, a rapid second send would slip through and create a SECOND
      // conversation, orphaning this answer.
      const pendingAssistantId = createPendingAssistantId();
      store.updateSlot(targetSlotId, {
        isStreaming: true,
        streamingQuestion: displayQuery,
        streamingContent: '',
        currentStatusMessage: null,
        streamingCitationMaps: null,
        messages: [
          ...currentSlot.messages,
          {
            role: 'user' as const,
            content: [{ type: 'text' as const, text: displayQuery }],
            metadata: {
              custom: {
                createdAt: new Date().toISOString(),
                ...(msgAttachments ? { attachments: msgAttachments } : {}),
              },
            },
          },
          {
            role: 'assistant' as const,
            id: pendingAssistantId,
            content: [{ type: 'text' as const, text: '' }],
          },
        ],
      });

      if (isNewConversation) {
        store.addPendingConversation(targetSlotId);
      }

      try {
        // Ensure the conversation id (create if missing). Shared, race-free
        // helper so a concurrent upload + send don't create two conversations.
        const convId = await ensureSlotConversation(targetSlotId);

        const { answer, sources } = await askQuestion(convId, apiQuery);

        const latest = useChatStore.getState().slots[targetSlotId];
        const baseMessages = latest ? latest.messages : currentSlot.messages;
        // Replace the empty assistant placeholder with the final answer; stash
        // the RAG sources under metadata.custom.sources for the renderer.
        const finalMessages: ThreadMessageLike[] = baseMessages.map((m) =>
          m.id === pendingAssistantId
            ? {
                ...m,
                content: [{ type: 'text' as const, text: answer }],
                metadata: { custom: { sources: sources ?? [] } },
              }
            : m
        );

        useChatStore.getState().updateSlot(targetSlotId, {
          streamingQuestion: '',
          streamingContent: '',
          currentStatusMessage: null,
          streamingCitationMaps: null,
          messages: finalMessages,
          hasLoaded: true,
          ...(isNewConversation ? { isOwner: true } : {}),
        });

        const resolvedStore = useChatStore.getState();
        if (isNewConversation) {
          // Promote the pending sidebar row to a real conversation entry.
          const nowIso = new Date().toISOString();
          resolvedStore.resolvePendingConversation(targetSlotId, {
            id: convId,
            title: apiQuery.slice(0, 80),
            createdAt: nowIso,
            updatedAt: nowIso,
            isShared: false,
            sharedWith: [],
            isOwner: true,
          });
        } else {
          resolvedStore.moveConversationToTop(convId);
        }
      } catch (err) {
        console.error('[rag] askQuestion failed for slot', targetSlotId, err);
        const errText =
          err instanceof Error ? err.message : 'An error occurred. Please try again.';
        const latest = useChatStore.getState().slots[targetSlotId];
        const baseMessages = latest ? latest.messages : currentSlot.messages;
        const finalMessages: ThreadMessageLike[] = baseMessages.map((m) =>
          m.id === pendingAssistantId
            ? { ...m, content: [{ type: 'text' as const, text: errText }] }
            : m
        );
        useChatStore.getState().updateSlot(targetSlotId, {
          streamingQuestion: '',
          streamingContent: '',
          currentStatusMessage: null,
          streamingCitationMaps: null,
          messages: finalMessages,
        });
        if (isNewConversation) {
          useChatStore.getState().clearPendingConversation(targetSlotId);
        }
      } finally {
        // Clear the busy flag on every terminal path (success and error).
        useChatStore.getState().updateSlot(targetSlotId, { isStreaming: false });
      }
    },

    onCancel: async () => {
      const targetSlotId = useChatStore.getState().activeSlotId;
      if (targetSlotId) {
        cancelStreamForSlot(targetSlotId);
      }
    },
  };
}

