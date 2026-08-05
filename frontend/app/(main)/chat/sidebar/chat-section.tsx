'use client';

import { Flex, Text } from '@radix-ui/themes';
import { StartChatButton, ChatItemSkeleton } from './chat-section-element';
import { TimeGroup } from './time-group';
import type { Conversation } from '@/chat/types';
import type { PendingConversation } from '@/chat/store';
import type { TimeGroupKey } from './time-group';

interface ChatSectionProps {
  timeGroups: Array<[TimeGroupKey, Conversation[]]>;
  isLoading: boolean;
  hasError: boolean;
  currentConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  skeletonCount: number;
  /** When true, the section grows to fill available space and scrolls */
  isScrollable?: boolean;
  /** Pending conversations to show as "Generating Title…" shimmers in Today group */
  pendingConversations?: PendingConversation[];
}

/**
 * The chat list section — time-grouped conversations with loading, error and
 * empty states.
 */
export function ChatSection({
  timeGroups,
  isLoading,
  hasError,
  currentConversationId,
  onSelectConversation,
  onNewChat,
  skeletonCount,
  isScrollable = false,
  pendingConversations = [],
}: ChatSectionProps) {
  const showGenerating = pendingConversations.length > 0;
  const isEmpty = timeGroups.length === 0 && !showGenerating;

  return (
    <Flex
      direction="column"
      style={isScrollable ? { flex: 1, minHeight: 0 } : undefined}
    >
      {hasError ? (
        <Flex direction="column" gap="2" style={{ padding: 'var(--space-2) var(--space-3)' }}>
          <Text size="1" style={{ color: '#ef4444' }}>
            {"Failed to load"}
          </Text>
          <StartChatButton onClick={onNewChat} />
        </Flex>
      ) : (
        <Flex
          direction="column"
          className={isScrollable ? 'no-scrollbar' : undefined}
          style={{
            ...(isScrollable ? { overflowY: 'auto', flex: 1 } : {}),
          }}
        >
          {isLoading ? (
            /* Skeleton loading state */
            <Flex direction="column" gap="1">
              {Array.from({ length: skeletonCount }, (_, i) => (
                <ChatItemSkeleton key={i} />
              ))}
            </Flex>
          ) : isEmpty ? (
            <StartChatButton onClick={onNewChat} />
          ) : (
            <Flex direction="column">
              {timeGroups.map(([label, convs]) => (
                <TimeGroup
                  key={label}
                  label={label}
                  conversations={convs}
                  currentConversationId={currentConversationId}
                  onSelectConversation={onSelectConversation}
                  pendingConversations={label === 'Today' ? pendingConversations : undefined}
                />
              ))}
              {/* If generating but no groups yet, show a standalone generating group */}
              {showGenerating && timeGroups.length === 0 && (
                <TimeGroup
                  label="Today"
                  conversations={[]}
                  currentConversationId={currentConversationId}
                  onSelectConversation={onSelectConversation}
                  pendingConversations={pendingConversations}
                />
              )}
            </Flex>
          )}
        </Flex>
      )}
    </Flex>
  );
}
