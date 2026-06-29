'use client';

import React, { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { Flex, Text } from '@radix-ui/themes';

import { useChatStore, selectPendingForSidebar } from '@/chat/store';
import { useCommandStore } from '@/lib/store/command-store';
import { useMobileSidebarStore } from '@/lib/store/mobile-sidebar-store';
import { useIsMobile } from '@/lib/hooks/use-is-mobile';
import { debugLog } from '@/chat/debug-logger';
import { ChatSection } from './chat-section';
import { groupConversationsByTime, getNonEmptyGroups } from './time-group';

/** Number of skeleton items shown while loading each section */
const YOUR_CHATS_SKELETON_COUNT = 3;

/**
 * Chat sections — renders "Your Chats" with time-grouped conversations and an
 * overflow "More" button.
 *
 * Wrapped in React.memo to prevent parent-cascade re-renders.
 */
export const ChatSections = React.memo(function ChatSections({
  onOpenMoreChats,
}: {
  onOpenMoreChats: (sectionType: 'shared' | 'your') => void;
}) {
  const searchParams = useSearchParams();
  const currentConversationId = searchParams?.get('conversationId') ?? null;
  const conversations = useChatStore((s) => s.conversations);
  const isConversationsLoading = useChatStore((s) => s.isConversationsLoading);
  const conversationsError = useChatStore((s) => s.conversationsError);
  const pendingConversations = useChatStore((s) => s.pendingConversations);
  const slots = useChatStore((s) => s.slots);
  const pagination = useChatStore((s) => s.pagination);

  // ── Render-reason tracking ──────────────────────────────────────
  debugLog.tick('[sidebar] [ChatSections]');
  const prevChatSectionsRef = React.useRef<Record<string, unknown>>({});
  const currentSectionsVals: Record<string, unknown> = {
    currentConversationId, conversations,
    isConversationsLoading, conversationsError, pendingConversations, slots, pagination,
  };
  const sectionsReasons: string[] = [];
  for (const [k, v] of Object.entries(currentSectionsVals)) {
    // eslint-disable-next-line react-hooks/refs -- intentional: debug render-reason tracking
    if (!Object.is(v, prevChatSectionsRef.current[k])) sectionsReasons.push(k);
  }
  if (sectionsReasons.length > 0) {
    debugLog.reason('[sidebar] [ChatSections]', sectionsReasons);
  }
  // eslint-disable-next-line react-hooks/refs -- intentional: update previous-props snapshot for next render diff
  prevChatSectionsRef.current = currentSectionsVals;

  const dispatch = useCommandStore((s) => s.dispatch);
  const closeMobileSidebar = useMobileSidebarStore((s) => s.close);
  const isMobile = useIsMobile();

  const handleNewChat = () => dispatch('newChat');
  const handleSelectConversation = () => {
    if (isMobile) closeMobileSidebar();
  };

  // "More" button removed — render every conversation in the scrollable Recents
  // list (older chats are also reachable via the ⌘+K search popup).
  const visibleYour = conversations;

  // Time-group "Your Chats"
  const yourTimeGroups = groupConversationsByTime(visibleYour);
  const yourNonEmptyGroups = getNonEmptyGroups(yourTimeGroups);

  const activePendingConversations = useMemo(() => {
    const convIds = new Set(conversations.map((c) => c.id));
    return selectPendingForSidebar(pendingConversations, slots, convIds, 'global');
  }, [pendingConversations, slots, conversations]);

  return (
    <Flex
      direction="column"
      gap="3"
      style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
    >
      {/* Recents — always visible wrapper for Your Chats */}
      <Flex
        direction="column"
        style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
      >
        {/* Recents header */}
        <Flex
          align="center"
          style={{
            height: 32,
            padding: '0 var(--space-3)',
            flexShrink: 0,
            userSelect: 'none',
          }}
        >
          <Text
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--slate-12)',
              lineHeight: 1,
            }}
          >
            {"Recents"}
          </Text>
        </Flex>

        <Flex
          direction="column"
          gap="3"
          style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
        >
          {/* Your Chats — time-grouped (label header suppressed; date-group headers remain) */}
          <ChatSection
            timeGroups={yourNonEmptyGroups}
            isLoading={isConversationsLoading}
            hasError={!!conversationsError}
            currentConversationId={currentConversationId}
            onSelectConversation={handleSelectConversation}
            onNewChat={handleNewChat}
            skeletonCount={YOUR_CHATS_SKELETON_COUNT}
            isScrollable
            hasMore={false}
            onMore={() => onOpenMoreChats('your')}
            pendingConversations={activePendingConversations}
          />
        </Flex>
      </Flex>
    </Flex>
  );
});
