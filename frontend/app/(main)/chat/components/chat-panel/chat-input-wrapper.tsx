'use client';

import { useCallback, useEffect } from 'react';
import { useThreadRuntime } from '@assistant-ui/react';
import { ChatInput } from '../chat-input';
import { useChatStore, ctxKeyFromAgent } from '@/chat/store';
import { useCommandStore } from '@/lib/store/command-store';
import { toast } from '@/lib/store/toast-store';
import { useEffectiveAgentId } from '@/chat/hooks/use-effective-agent-id';
import { fetchModelsForContext } from '@/chat/utils/fetch-models-for-context';
import { ChatApi } from '@/chat/api';
import {
  ensureSlotConversation,
  regenerateAnswer,
  uploadAttachment,
} from '@/chat/rag-api';
import {
  buildAssistantApiFilters,
  type AttachmentRef,
  type ChatCollectionAttachment,
  type SearchRequest,
} from '@/chat/types';
import {
  isRequestCancelledError,
  isSearchNoAccessibleDocumentsNotFound,
} from '@/lib/api';
import { useServicesHealthStore } from '@/lib/store/services-health-store';

// Module-level abort controller for cancelling in-flight searches
let currentSearchAbort: AbortController | null = null;
/** Increments on each submit so superseded requests never clear loading for a newer search. */
let searchSubmitGeneration = 0;
let lastEffectiveAgentIdForQueryMode: string | null = null;

/**
 * Wrapper component that connects ChatInput to assistant-ui runtime.
 * Must be used inside AssistantRuntimeProvider.
 */
export function ChatInputWrapper() {
  const threadRuntime = useThreadRuntime();
  const effectiveAgentId = useEffectiveAgentId();
  const isAgentChat = Boolean(effectiveAgentId);

  useEffect(() => {
    if (effectiveAgentId) {
      lastEffectiveAgentIdForQueryMode = effectiveAgentId;
      const store = useChatStore.getState();
      store.setQueryMode('agent');
      if (store.settings.mode === 'search') {
        store.setMode('chat');
        store.clearSearchResults();
      }
      return;
    }

    if (lastEffectiveAgentIdForQueryMode !== null) {
      lastEffectiveAgentIdForQueryMode = null;
      useChatStore.getState().setQueryMode('chat');
    }
  }, [effectiveAgentId]);

  // Make sure models for the EFFECTIVE context (URL or slot agent) are loaded
  // and validated, regardless of which URL the page was opened on. This keeps
  // the pill + submit in sync when the active slot carries an agent that the
  // URL doesn't reflect (e.g. navigating into an existing agent conversation).
  // The fetch util dedupes so this is cheap when page.tsx already ran.
  useEffect(() => {
    const ctxKey = ctxKeyFromAgent(effectiveAgentId);
    fetchModelsForContext(ctxKey).catch((err) => {
      if (useServicesHealthStore.getState().apiServerReachable) {
        console.error('Failed to fetch models for effective context', ctxKey, err);
      }
    });
  }, [effectiveAgentId]);

  const handleSearchSubmit = async (query: string) => {
    const store = useChatStore.getState();

    // Cancel any in-flight search
    if (currentSearchAbort) {
      currentSearchAbort.abort();
    }
    const myGeneration = ++searchSubmitGeneration;
    const searchController = new AbortController();
    currentSearchAbort = searchController;

    store.setIsSearching(true);
    store.setSearchError(null);

    const streamFilters = buildAssistantApiFilters(store.settings.filters);
    const request: SearchRequest = {
      query,
      limit: 10,
      filters: {
        apps: streamFilters.apps,
        kb: streamFilters.kb,
      },
    };

    try {
      const response = await ChatApi.search(request, searchController.signal);
      store.setSearchResults(
        response.searchResponse.searchResults,
        response.searchId,
        query
      );
    } catch (error: unknown) {
      if (isRequestCancelledError(error)) return;
      if (isSearchNoAccessibleDocumentsNotFound(error)) {
        store.setSearchResults([], null, query);
        return;
      }
      store.setSearchError((error as Error)?.message || 'Search failed');
    } finally {
      if (currentSearchAbort === searchController) {
        currentSearchAbort = null;
      }
      if (myGeneration === searchSubmitGeneration) {
        store.setIsSearching(false);
      }
    }
  };

  /**
   * Per-file upload, fired by `ChatInput` the moment a chip is added to the
   * composer. Uploads through the RAG backend, which ingests + chunks the
   * file against a conversation. A new chat has no conversation yet, so we
   * ensure one first (race-free, shared with the send path) and resolve it
   * onto the active slot so the same id is reused on send + the URL-sync
   * effect picks it up. `signal` is forwarded so `ChatInput` can abort the
   * upload when the user removes a chip mid-flight.
   */
  const handleUploadFile = useCallback(
    async (file: File, signal: AbortSignal): Promise<AttachmentRef> => {
      const store = useChatStore.getState();

      // Ensure there is an active slot to own the conversation.
      let activeSlotId = store.activeSlotId;
      if (!activeSlotId) {
        activeSlotId = store.createSlot(null);
        store.setActiveSlot(activeSlotId);
      }

      // Ensure the slot has a real conversation id — uploads are
      // conversation-scoped. Shared, race-free helper so a concurrent send
      // doesn't create a second conversation.
      // keepTemp: a file upload alone must not flip the composer out of the
      // centered new-chat view (that remounts it and drops the chip). The slot
      // stays "temp" until the first message is sent.
      const conversationId = await ensureSlotConversation(activeSlotId, {
        keepTemp: true,
      });

      const { attachmentId, status } = await uploadAttachment(conversationId, file, signal);

      // A file whose ingestion failed is treated as a failed upload: throw so the
      // composer drops the chip (ChatInput.startUpload) and never attaches it to a
      // message. We also skip the version bump so it never shows in the files
      // panel. The backend may keep a `failed` record, but the panel filters it out.
      if (status === 'failed') {
        throw new Error('This file could not be processed.');
      }

      // Tell the right-side files panel to refetch so the new document shows up.
      store.bumpAttachmentsVersion();

      const extension = file.name.includes('.')
        ? file.name.split('.').pop()?.toLowerCase() ?? ''
        : '';

      // Adapt the RAG upload response into the AttachmentRef shape ChatInput expects.
      return {
        recordId: attachmentId,
        virtualRecordId: attachmentId,
        recordName: file.name,
        mimeType: file.type,
        extension,
      };
    },
    [],
  );

  const handleDeleteFile = useCallback(
    (recordId: string) => {
      // Fire and forget — must never block the UI.
      ChatApi.deleteAttachment(recordId, { agentId: effectiveAgentId }).catch(() => {
        // Swallow silently: an orphan record is acceptable; blocking the UI is not.
      });
    },
    [effectiveAgentId],
  );

  const handleSend = async (message: string, attachments?: AttachmentRef[]) => {
    if (!message.trim() && (!attachments || attachments.length === 0)) return;

    const store = useChatStore.getState();

    // Search mode: direct API call, no slots/runtime (disabled for agent-scoped chat)
    // Attachments are not supported in search mode — silently ignored.
    if (store.settings.mode === 'search' && !isAgentChat) {
      if (message.trim()) handleSearchSubmit(message.trim());
      return;
    }

    // ── Chat mode ──
    if (store.activeSlotId && store.slots[store.activeSlotId]?.isStreaming) {
      return;
    }

    // Ensure a slot exists for new chats
    let activeSlotId = store.activeSlotId;
    if (!activeSlotId) {
      activeSlotId = store.createSlot(null);
      store.setActiveSlot(activeSlotId);
      const rawAgentId =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('agentId')
          : null;
      const agentIdFromUrl = rawAgentId?.trim() ? rawAgentId : null;
      if (agentIdFromUrl) {
        store.updateSlot(activeSlotId, {
          threadAgentId: agentIdFromUrl,
          agentStreamTools:
            store.agentStreamTools === null ? null : [...store.agentStreamTools],
        });
      }
    }

    const { settings, collectionNamesCache } = store;

    // Collections for message metadata + slot UI; `settings.filters` is not cleared on send.
    const hubApps = settings.filters.apps ?? [];
    const recordGroups = settings.filters.kb ?? [];
    const collectionsAtSendTime: ChatCollectionAttachment[] = [
      ...hubApps.map((id) => ({
        id,
        name: collectionNamesCache[id] || 'Collection',
        kind: 'collectionRoot' as const,
      })),
      ...recordGroups.map((id) => ({
        id,
        name: collectionNamesCache[id] || 'Collection',
        kind: 'recordGroup' as const,
      })),
    ];

    if (collectionsAtSendTime.length > 0) {
      store.updateSlot(activeSlotId, {
        pendingCollections: collectionsAtSendTime,
      });
    }

    // Attachments were uploaded the moment they were added to the composer,
    // so by the time we reach here every ref is already server-assigned.
    // Forward verbatim to the runtime; no upload step at send time.
    threadRuntime.append({
      role: 'user',
      content: [{ type: 'text', text: message }],
      metadata: {
        custom: {
          collections: collectionsAtSendTime.length > 0 ? collectionsAtSendTime : undefined,
          attachments: attachments && attachments.length > 0 ? attachments : undefined,
        },
      },
      startRun: true,
    });
  };

  // Retry (message-actions "Retry" button) regenerates the latest answer IN
  // PLACE: the backend re-runs the last question and overwrites that assistant
  // message, and we swap the new answer into the existing bubble (no new turn).
  // A plain content swap with a "Regenerating…" placeholder — robust for the RAG
  // message shape (which keys on `id` + `metadata.custom.sources`, not the SSE
  // streaming-overlay path).
  useEffect(() => {
    const { register, unregister } = useCommandStore.getState();
    register('retryAsk', async () => {
      const store = useChatStore.getState();
      const slotId = store.activeSlotId;
      if (!slotId) return;
      const slot = store.slots[slotId];
      if (!slot || !slot.convId || slot.isStreaming) return;

      const original = slot.messages ?? [];
      // The backend regenerates the LAST assistant message; find it here.
      let targetId: string | null = null;
      for (let i = original.length - 1; i >= 0; i--) {
        if (original[i].role === 'assistant') {
          targetId = (original[i].id as string) ?? null;
          break;
        }
      }
      if (!targetId) return;

      // Optimistic placeholder so the user sees it working, then disable the
      // composer for the duration via isStreaming.
      const withPlaceholder = original.map((m) =>
        m.id === targetId
          ? {
              ...m,
              content: [{ type: 'text' as const, text: 'Regenerating…' }],
              // Clear the old sources too, so the previous answer's citations
              // don't linger under "Regenerating…" (or through a failed retry).
              metadata: { custom: { sources: [] } },
            }
          : m,
      );
      store.updateSlot(slotId, { messages: withPlaceholder, isStreaming: true });

      try {
        const { answer, sources } = await regenerateAnswer(slot.convId);
        const cur = useChatStore.getState().slots[slotId]?.messages ?? [];
        const next = cur.map((m) =>
          m.id === targetId
            ? {
                ...m,
                content: [{ type: 'text' as const, text: answer }],
                metadata: { custom: { sources: sources ?? [] } },
              }
            : m,
        );
        useChatStore.getState().updateSlot(slotId, { messages: next, isStreaming: false });
      } catch {
        // Restore the original answer on failure.
        const cur = useChatStore.getState().slots[slotId]?.messages ?? [];
        const restored = cur.map((m) =>
          m.id === targetId ? original.find((o) => o.id === targetId) ?? m : m,
        );
        useChatStore.getState().updateSlot(slotId, { messages: restored, isStreaming: false });
        toast.error("Couldn't regenerate the answer. Please try again.");
      }
    });
    return () => unregister('retryAsk');
  }, []);

  return (
    <ChatInput
      onSend={handleSend}
      onUploadFile={handleUploadFile}
      onDeleteFile={handleDeleteFile}
      isAgentChat={isAgentChat}
      agentId={effectiveAgentId}
    />
  );
}
