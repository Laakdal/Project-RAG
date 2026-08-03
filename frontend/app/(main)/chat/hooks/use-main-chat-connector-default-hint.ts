'use client';

import { useIsMainChatRoute } from '@/chat/hooks/use-is-main-chat-route';

/** True on the main `/chat` route (assistant connector picker). */
export function useMainChatConnectorDefaultHint(): boolean {
  return useIsMainChatRoute();
}
