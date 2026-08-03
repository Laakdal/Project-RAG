/**
 * Slot-scoped SSE streaming logic.
 *
 * Extracted from the old ChatModelAdapter — this module is purely
 * imperative (no React hooks) so SSE streams can write to any slot
 * in Zustand regardless of which slot is currently active.
 *
 * Key design:
 * - `streamMessageForSlot()` handles new + existing conversations.
 * - `streamRegenerateForSlot()` handles message regeneration.
 * - rAF batching collapses high-frequency SSE chunks into one Zustand
 *   write per animation frame. Background (inactive) slot writes happen
 *   silently — no React component subscribes to those fields.
 */

import { startTransition } from 'react';
import { ChatApi, type StreamMessageCallbacks } from './api';
import { AgentsApi } from '@/app/(main)/agents/api';
import { useChatStore, ctxKeyFromAgent, getEffectiveModel } from './store';
import { debugLog } from './debug-logger';
import { loadHistoricalMessages, getThreadMessagePlainText } from './runtime';
import { markFailedTurn } from './retry-plan';
import type { ThreadMessageLike } from '@assistant-ui/react';
import {
  buildAssistantApiFilters,
  buildStreamRequestModeFields,
  streamChatModeToAgentApiChatMode,
  type StreamChatRequest,
  type StatusMessage,
  type ModelOverride,
  type SSEConnectedEvent,
  type ChatArtifact,
  type SSEArtifactEvent,
} from './types';
import {
  buildCitationMapsFromStreaming,
} from './components/message-area/response-tabs/citations';
import { pickModelInfoFromConversationBundle } from './utils/apply-conversation-model-info';
import { CONVERSATION_MESSAGES_PAGE_SIZE } from './constants';

/** Stable id for the in-flight assistant placeholder (works on HTTP where randomUUID is missing). */
function createPendingAssistantId(): string {
  const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return `asst-pending-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * If the last message is the empty placeholder assistant for an in-flight stream,
 * replace it with the error text. Otherwise append a new assistant error row.
 *
 * Either way the result is tagged with the question that failed: the turn never
 * reached the database, so Retry has to re-ask it rather than ask the server to
 * redo "the last answer" (which would be the previous, unrelated turn).
 */
function withStreamingErrorMessage(
  currentMessages: ThreadMessageLike[],
  errorText: string,
  question: string
): ThreadMessageLike[] {
  const last = currentMessages[currentMessages.length - 1];
  const withError =
    last?.role === 'assistant' && getThreadMessagePlainText(last).trim() === ''
      ? [
          ...currentMessages.slice(0, -1),
          { ...last, content: [{ type: 'text' as const, text: errorText }] },
        ]
      : [
          ...currentMessages,
          { role: 'assistant' as const, content: [{ type: 'text' as const, text: errorText }] },
        ];
  return markFailedTurn(withError, question);
}

function statusMessageFromConnectedEvent(data: SSEConnectedEvent): StatusMessage {
  const raw = typeof data?.message === 'string' ? data.message.trim() : '';
  const looksTechnical =
    raw.length === 0 ||
    /^sse\b/i.test(raw) ||
    /\bconnection\s+established\b/i.test(raw);
  return {
    id: 'status-connected',
    status: 'connected',
    message: looksTechnical ? 'Connected — working on your request…' : raw,
    timestamp: new Date().toISOString(),
  };
}

/** Clear partial stream output when the backend emits `restreaming` (citation verify / re-parse). */
function statusMessageRestreaming(): StatusMessage {
  return {
    id: `status-restreaming-${Date.now()}`,
    status: 'restreaming',
    message: "Refining response…",
    timestamp: new Date().toISOString(),
  };
}

interface StatusDwellScheduler {
  /** Force-apply a status immediately (bypasses dwell window). Used by restreaming. */
  applyStatus: (msg: StatusMessage | null) => void;
  /** Enqueue a status; coalesces bursts so each visible status dwells ≥ `minDwellMs`. */
  scheduleStatus: (msg: StatusMessage) => void;
  /** Drop any pending status and cancel the dwell timer. */
  cancelPendingStatus: () => void;
}

/**
 * Minimum-dwell scheduler for SSE status messages.
 *
 * Backend can emit bursts of status events (planning → executing → analyzing
 * → generating) within a few ms. Writing each one directly to the store
 * overwrites the previous before React paints, so users see statuses blink
 * past. This scheduler guarantees each visible status stays for at least
 * `minDwellMs`. Events arriving inside the window are coalesced — latest
 * wins — and flushed when the window elapses.
 */
function createStatusDwellScheduler(
  slotId: string,
  minDwellMs = 400
): StatusDwellScheduler {
  let lastStatusAt = 0;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingStatus: StatusMessage | null = null;

  function applyStatus(msg: StatusMessage | null): void {
    lastStatusAt = Date.now();
    useChatStore.getState().updateSlot(slotId, { currentStatusMessage: msg });
  }

  function scheduleStatus(msg: StatusMessage): void {
    const elapsed = Date.now() - lastStatusAt;
    if (elapsed >= minDwellMs) {
      if (statusTimer !== null) { clearTimeout(statusTimer); statusTimer = null; }
      pendingStatus = null;
      applyStatus(msg);
      return;
    }
    pendingStatus = msg;
    if (statusTimer !== null) return;
    statusTimer = setTimeout(() => {
      statusTimer = null;
      if (pendingStatus) {
        const m = pendingStatus;
        pendingStatus = null;
        applyStatus(m);
      }
    }, minDwellMs - elapsed);
  }

  function cancelPendingStatus(): void {
    if (statusTimer !== null) { clearTimeout(statusTimer); statusTimer = null; }
    pendingStatus = null;
  }

  return { applyStatus, scheduleStatus, cancelPendingStatus };
}


/**
 * Regenerate a bot response for a specific slot.
 *
 * Similar to `streamMessageForSlot` but uses the regenerate endpoint
 * and replaces the last assistant message rather than appending.
 *
 * @param slotId    — stable slot key
 * @param messageId — backend _id of the bot_response to regenerate
 */
export async function streamRegenerateForSlot(
  slotId: string,
  messageId: string,
  modelOverride?: ModelOverride,
  originalFilters?: { apps: string[]; kb: string[] }
): Promise<void> {
  const store = useChatStore.getState();
  const slot = store.slots[slotId];
  if (!slot || !slot.convId) return;

  // Resolve model: explicit override → context-scoped selection/default.
  // Context is the slot's own agent (so regenerate for an agent thread
  // always picks from that agent's models, never leaks assistant choices).
  const regenCtxKey = ctxKeyFromAgent(slot.threadAgentId ?? null);
  const resolvedModel: ModelOverride =
    modelOverride
      ?? getEffectiveModel(regenCtxKey)
      ?? { modelKey: '', modelName: '', modelFriendlyName: '' };

  const abortController = new AbortController();

  store.updateSlot(slotId, {
    isStreaming: true,
    regenerateMessageId: messageId,
    streamingContent: '',
    currentStatusMessage: null,
    streamingCitationMaps: null,
    abortController,
  });

  debugLog.flush('regenerate-started', { slotId, messageId });

  // ── Time-throttled content + citation accumulator (same as streamMessageForSlot) ──
  const ACTIVE_FLUSH_MS = 16;
  const BACKGROUND_FLUSH_MS = 200;
  let accumulatedContent = '';
  let pendingCitationMaps: ReturnType<typeof buildCitationMapsFromStreaming> | null = null;
  let lastCitationKey = '';
  let lastFlushTime = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let clearedStatusWhenAnswerVisible = false;

  // Minimum-dwell scheduler for SSE status messages (see
  // createStatusDwellScheduler for the rationale).
  const { applyStatus, scheduleStatus, cancelPendingStatus } =
    createStatusDwellScheduler(slotId);

  function flushContentToStore() {
    debugLog.rafFlush();
    const citationMaps = pendingCitationMaps;
    if (citationMaps) {
      pendingCitationMaps = null;
    }
    useChatStore.getState().updateSlot(slotId, {
      streamingContent: accumulatedContent,
      ...(citationMaps ? { streamingCitationMaps: citationMaps } : {}),
    });
  }

  function scheduleFlush() {
    const now = Date.now();
    const isActive = useChatStore.getState().activeSlotId === slotId;
    const interval = isActive ? ACTIVE_FLUSH_MS : BACKGROUND_FLUSH_MS;
    if (now - lastFlushTime >= interval) {
      if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
      lastFlushTime = now;
      flushContentToStore();
    } else if (flushTimer === null) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        lastFlushTime = Date.now();
        flushContentToStore();
      }, interval - (now - lastFlushTime));
    }
  }

  const rawAgentIdFromUrl =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('agentId') : null;
  const agentIdFromUrl = rawAgentIdFromUrl?.trim() ? rawAgentIdFromUrl : null;
  const slotAgentId = slot.threadAgentId?.trim() || null;
  const threadAgentId = slotAgentId ?? agentIdFromUrl;
  /** Which API we use for reload — frozen at regen start (URL may change before `complete`) */
  const reloadViaAgentId = threadAgentId;

  const regenerateCallbacks: StreamMessageCallbacks = {
    onConnected: (data) => {
      scheduleStatus(statusMessageFromConnectedEvent(data));
    },

    onRestreaming: () => {
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      cancelPendingStatus();
      accumulatedContent = '';
      lastCitationKey = '';
      clearedStatusWhenAnswerVisible = false;
      pendingCitationMaps = null;
      useChatStore.getState().updateSlot(slotId, {
        streamingContent: '',
        streamingCitationMaps: null,
      });
      applyStatus(statusMessageRestreaming());
    },

    onStatus: (data) => {
      scheduleStatus({
        id: `status-${Date.now()}`,
        status: data.status,
        message: data.message,
        timestamp: new Date().toISOString(),
      });
    },

    onChunk: (data) => {
      debugLog.chunk();
      accumulatedContent = data.accumulated;
      if (!clearedStatusWhenAnswerVisible && data.accumulated.length > 0) {
        clearedStatusWhenAnswerVisible = true;
        cancelPendingStatus();
        useChatStore.getState().updateSlot(slotId, { currentStatusMessage: null });
      }
      if (data.citations && data.citations.length > 0) {
        const key = JSON.stringify(data.citations);
        if (key !== lastCitationKey) {
          lastCitationKey = key;
          pendingCitationMaps = buildCitationMapsFromStreaming(data.citations);
        }
      }
      scheduleFlush();
    },

    onComplete: async () => {
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      cancelPendingStatus();
      try {
        const detail = reloadViaAgentId
          ? await AgentsApi.fetchAgentConversation(reloadViaAgentId, slot.convId!)
          : await ChatApi.fetchConversation(slot.convId!);
        const finalMessages = loadHistoricalMessages(detail.messages);
        const postRegenModelInfo = pickModelInfoFromConversationBundle({
          modelInfo: detail.conversation.modelInfo,
          messages: detail.messages,
        });
        const regenPagination = detail.pagination
          ? {
              currentPage: detail.pagination.page,
              hasOlderMessages: detail.pagination.hasNextPage,
              isLoadingOlder: false,
            }
          : undefined;

        useChatStore.getState().updateSlot(slotId, {
          isStreaming: false,
          regenerateMessageId: null,
          streamingContent: '',
          currentStatusMessage: null,
          streamingCitationMaps: null,
          messages: finalMessages,
          abortController: null,
          ...(regenPagination ? { messagePagination: regenPagination } : {}),
          ...(postRegenModelInfo ? { conversationModelInfo: postRegenModelInfo } : {}),
        });
        debugLog.flush('regenerate-completed', { slotId, messageId });
      } catch (err) {
        console.error('[streaming] Failed to reload after regenerate:', err);
        useChatStore.getState().updateSlot(slotId, {
          isStreaming: false,
          regenerateMessageId: null,
          streamingContent: '',
          currentStatusMessage: null,
          streamingCitationMaps: null,
          abortController: null,
        });
        debugLog.flush('regenerate-reload-error', { slotId });
      }
    },

    onError: (error: Error) => {
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      cancelPendingStatus();
      console.error('[streaming] Regenerate error for slot', slotId, error);
      useChatStore.getState().updateSlot(slotId, {
        isStreaming: false,
        regenerateMessageId: null,
        streamingContent: '',
        currentStatusMessage: null,
        streamingCitationMaps: null,
        abortController: null,
      });
      debugLog.flush('regenerate-error', { slotId });
    },

    signal: abortController.signal,
  };

  try {
    if (threadAgentId && slotAgentId !== threadAgentId) {
      useChatStore.getState().updateSlot(slotId, { threadAgentId });
    }
    /** Strip `instanceId:` prefix added for UI multi-instance isolation. */
    const stripInstancePrefix = (key: string) => {
      const colon = key.indexOf(':');
      return colon >= 0 ? key.slice(colon + 1) : key;
    };

    if (threadAgentId) {
      const { chatMode } = buildStreamRequestModeFields(store.settings);
      const agentApiChatMode = streamChatModeToAgentApiChatMode(chatMode);
      // Read agent tools from the store at regen time so the correct tool set
      // is used even when the user changed the selection between turns.
      const agentToolsSel = useChatStore.getState().agentStreamTools;
      const agentToolCatalog = useChatStore.getState().agentToolCatalogFullNames;
      const regenTools = [...new Set(
        (agentToolsSel === null ? [...agentToolCatalog] : [...agentToolsSel]).map(stripInstancePrefix)
      )];
      await ChatApi.streamAgentRegenerate(
        threadAgentId,
        slot.convId,
        messageId,
        regenerateCallbacks,
        {
          modelKey: resolvedModel.modelKey.trim(),
          modelName: resolvedModel.modelName || resolvedModel.modelKey,
          chatMode: agentApiChatMode,
          tools: regenTools,
          filters: originalFilters ?? buildAssistantApiFilters(store.settings.filters),
        }
      );
    } else {
      const { chatMode } = buildStreamRequestModeFields(store.settings);
      // Universal agent mode: read current tool selection at regen time
      const isUniversalAgent = store.settings.queryMode === 'agent';
      const universalToolsSel = useChatStore.getState().universalAgentStreamTools;
      const universalToolCatalog = useChatStore.getState().universalAgentToolCatalogFullNames;
      // null → "all tools" (send full catalog), array → explicit subset, undefined → not an agent turn
      // Strip instanceId prefix from internal keys before putting on the wire.
      const regenStreamTools = isUniversalAgent
        ? [...new Set(
            (universalToolsSel === null ? [...universalToolCatalog] : [...universalToolsSel]).map(stripInstancePrefix)
          )]
        : undefined;
      await ChatApi.streamRegenerate(slot.convId, messageId, regenerateCallbacks, {
        modelKey: resolvedModel.modelKey,
        modelName: resolvedModel.modelName,
        modelFriendlyName: resolvedModel.modelFriendlyName,
        chatMode,
        filters: originalFilters ?? buildAssistantApiFilters(store.settings.filters),
        ...(regenStreamTools !== undefined ? { agentStreamTools: regenStreamTools } : {}),
      });
    }
  } catch (error) {
    if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
    cancelPendingStatus();
    console.error('[streaming] Fatal regenerate error for slot', slotId, error);
    useChatStore.getState().updateSlot(slotId, {
      isStreaming: false,
      regenerateMessageId: null,
      streamingContent: '',
      currentStatusMessage: null,
      streamingCitationMaps: null,
      abortController: null,
    });
    debugLog.flush('regenerate-fatal-error', { slotId });
  }
}

/**
 * Cancel the active stream for a slot by aborting its AbortController.
 */
export function cancelStreamForSlot(slotId: string): void {
  const store = useChatStore.getState();
  const slot = store.slots[slotId];
  if (!slot) return;

  slot.abortController?.abort();
  store.updateSlot(slotId, {
    isStreaming: false,
    streamingContent: '',
    streamingQuestion: '',
    currentStatusMessage: null,
    streamingCitationMaps: null,
    abortController: null,
    regenerateMessageId: null,
  });
  if (slot.isTemp) {
    store.clearPendingConversation(slotId);
  }
  debugLog.flush('stream-cancelled', { slotId });
}

/**
 * Load the next (older) page of messages for a slot and prepend them.
 *
 * Claude/ChatGPT-style infinite scroll: page 1 = most recent batch;
 * each subsequent page returns an older batch. The MessageList calls this
 * when the user scrolls near the top while `messagePagination.hasOlderMessages`.
 */
export async function loadOlderMessagesForSlot(slotId: string): Promise<void> {
  const store = useChatStore.getState();
  const slot = store.slots[slotId];
  if (!slot || !slot.convId) return;

  const pagination = slot.messagePagination;
  if (!pagination?.hasOlderMessages || pagination.isLoadingOlder) return;

  const nextPage = pagination.currentPage + 1;

  // Mark loading so concurrent scroll events don't double-trigger
  store.updateSlot(slotId, {
    messagePagination: { ...pagination, isLoadingOlder: true },
  });

  try {
    const detail = slot.threadAgentId
      ? await AgentsApi.fetchAgentConversation(slot.threadAgentId, slot.convId, { page: nextPage })
      : await ChatApi.fetchConversation(slot.convId, nextPage);

    const olderMessages = loadHistoricalMessages(detail.messages);
    const newPagination = {
      currentPage: detail.pagination.page,
      hasOlderMessages: detail.pagination.hasNextPage,
      isLoadingOlder: false,
    };

    // Read the freshest slot state at write time to avoid stale closure
    const freshSlot = useChatStore.getState().slots[slotId];
    if (!freshSlot) return;

    // Deduplicate: if the API returns messages whose IDs are already in the
    // thread (e.g. because a previous SSE complete gave us all messages), drop
    // them to prevent assistant-ui's MessageRepository from crashing with
    // "same id already exists in parent tree".
    const existingIds = new Set(freshSlot.messages.map((m) => m.id));
    const uniqueOlderMessages = olderMessages.filter((m) => !existingIds.has(m.id));

    if (uniqueOlderMessages.length === 0) {
      // All "older" messages are already present → nothing new to prepend;
      // mark pagination exhausted so we don't retry on the next scroll.
      useChatStore.getState().updateSlot(slotId, {
        messagePagination: { currentPage: nextPage, hasOlderMessages: false, isLoadingOlder: false },
      });
      return;
    }

    useChatStore.getState().updateSlot(slotId, {
      // Prepend unique older messages before the existing messages
      messages: [...uniqueOlderMessages, ...freshSlot.messages],
      messagePagination: newPagination,
    });
  } catch (err) {
    console.error('[streaming] Failed to load older messages for slot', slotId, err);
    useChatStore.getState().updateSlot(slotId, {
      messagePagination: { ...pagination, isLoadingOlder: false },
    });
  }
}
