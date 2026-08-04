/**
 * Slot-scoped stream teardown.
 *
 * Extracted from the old ChatModelAdapter — this module is purely
 * imperative (no React hooks) so it can write to any slot in Zustand
 * regardless of which slot is currently active.
 *
 * The SSE senders that used to live here targeted `/api/v1/conversations/*`,
 * which this backend does not serve. The live send and regenerate paths are
 * `runtime.ts` -> `askQuestion` / `regenerateAnswer` in `rag-api.ts`, so only
 * the cancel path survives.
 */

import { useChatStore } from './store';
import { debugLog } from './debug-logger';

/** Abort the in-flight request for a slot and clear its streaming state. */
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
