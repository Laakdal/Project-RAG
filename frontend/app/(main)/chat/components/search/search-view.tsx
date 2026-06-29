'use client';

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import { buildChatHref } from '@/chat/build-chat-url';
import { useChatStore } from '@/chat/store';
import { Box, Flex, Text, TextField, Theme } from '@radix-ui/themes';
import { useThemeAppearance } from '@/app/components/theme-provider';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import { useCommandStore } from '@/lib/store/command-store';
import { groupConversationsByTime, getNonEmptyGroups } from '@/chat/sidebar/time-group';
import type { TimeGroupKey } from '@/lib/utils/group-by-time';
import { TimeGroupedSkeleton } from './skeleton';
import { ChatRow } from './chat-row';
import { SearchResultRow } from './search-result-row';
import { CommandPalette } from './command-palette';

// ── Constants ──

/** Labels for time-group headings */
const TIME_GROUP_LABELS: Record<TimeGroupKey, string> = {
  'Today': 'Today',
  'Yesterday': 'Yesterday',
  'Previous 7 Days': 'Last 7 days',
  'Older': 'Older',
};

// ── Main component ──

interface ChatSearchProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Chat search overlay — triggered by ⌘+K.
 *
 * Lists come from `ChatApi.fetchConversations` (browse: no search; query: `search` param).
 * Rendered via React Portal to avoid z-index issues.
 */
export function ChatSearch({ open, onClose }: ChatSearchProps) {
  const { appearance } = useThemeAppearance();
  const router = useRouter();
  const searchParams = useSearchParams();
  const agentId = searchParams.get('agentId');
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [contentLeft, setContentLeft] = useState(0);

  // Conversations come from the chat store — the same list the sidebar renders
  // (loaded from GET /chat/conversations). Browse shows all; search filters by
  // title client-side. (The old ChatApi.fetchConversations endpoint isn't served
  // by this backend, which is why this popup used to show "No chats yet".)
  const allConversations = useChatStore((s) => s.conversations);
  const conversationsLoading = useChatStore((s) => s.isConversationsLoading);

  const dispatch = useCommandStore((s) => s.dispatch);

  // ── Measure main content area offset ──
  useEffect(() => {
    if (!open) return;

    function measure() {
      const contentArea = document.querySelector('[data-main-content]');
      if (contentArea) {
        setContentLeft(contentArea.getBoundingClientRect().left);
      }
    }

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);

  // Reset input when overlay opens (debounced value follows via useDebouncedSearch; empty clears immediately)
  useEffect(() => {
    if (!open) return;
    setSearchQuery('');
  }, [open]);

  // ── Focus input on open ──
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open]);

  // ── Escape to close ──
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // ── Body scroll lock ──
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const trimmedInput = searchQuery.trim();
  const inSearchMode = trimmedInput.length > 0;

  // Search filters the store's conversations by title (client-side, instant).
  const searchResults = useMemo(() => {
    if (!inSearchMode) return [];
    const q = trimmedInput.toLowerCase();
    return allConversations.filter((c) => (c.title ?? '').toLowerCase().includes(q));
  }, [allConversations, inSearchMode, trimmedInput]);

  const timeGroups = useMemo(
    () =>
      inSearchMode
        ? []
        : getNonEmptyGroups(groupConversationsByTime(allConversations)),
    [allConversations, inSearchMode],
  );

  // ── Handlers ──
  const handleNewChat = useCallback(() => {
    onClose();
    dispatch('newChat');
  }, [onClose, dispatch]);

  const handleSelectConversation = useCallback(
    (id: string) => {
      onClose();
      router.push(
        buildChatHref({
          agentId: agentId || undefined,
          conversationId: id,
        })
      );
    },
    [onClose, router, agentId]
  );

  const handleSearchSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
  }, []);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  }, []);

  if (!open) return null;

  const overlay = (
    <Theme
      accentColor="jade"
      grayColor="olive"
      appearance={appearance}
      radius="medium"
    >
      <div
        onClick={(e: React.MouseEvent) => {
          if (e.target === e.currentTarget) onClose();
        }}
        style={{
          position: 'fixed',
          top: 0,
          left: contentLeft,
          right: 0,
          bottom: 0,
          zIndex: 50,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          paddingTop: '15vh',
        }}
      >
        <Flex
          ref={panelRef}
          direction="column"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
          style={{
            width: '37.5rem',
            maxHeight: '512px',
            backdropFilter: 'blur(25px)',
            WebkitBackdropFilter: 'blur(25px)',
            backgroundColor: 'var(--effects-translucent)',
            border: '1px solid var(--olive-3)',
            borderRadius: 'var(--radius-2)',
            boxShadow: '0px 20px 48px 0px var(--black-a6)',
            overflow: 'hidden',
          }}
        >
          {/* Search input */}
          <form onSubmit={handleSearchSubmit}>
            <Box style={{ padding: 'var(--space-3) var(--space-3) 0' }}>
              <TextField.Root
                ref={inputRef}
                size="3"
                placeholder={"Search Chats..."}
                value={searchQuery}
                onChange={handleSearchChange}
                style={{ width: '100%' }}
              >
                <TextField.Slot>
                  <MaterialIcon name="search" size={18} color="var(--slate-a11)" />
                </TextField.Slot>
              </TextField.Root>
            </Box>
          </form>

          {/* Command Palette row (New Chat action) */}
          <CommandPalette onClick={handleNewChat} />

          {/* Scrollable content area */}
          <Box
            className="no-scrollbar"
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '0 var(--space-3) var(--space-3)',
            }}
          >
            {inSearchMode ? (
              searchResults.length > 0 ? (
                <Flex direction="column" gap="1">
                  {searchResults.map((conv) => (
                    <SearchResultRow
                      key={conv.id}
                      conversation={conv}
                      onClick={() => handleSelectConversation(conv.id)}
                    />
                  ))}
                </Flex>
              ) : (
                <Flex align="center" justify="center" style={{ padding: 'var(--space-6)' }}>
                  <Text size="2" style={{ color: 'var(--slate-a9)' }}>
                    {"No results found"}
                  </Text>
                </Flex>
              )
            ) : conversationsLoading ? (
              <TimeGroupedSkeleton />
            ) : (
              <Flex direction="column" gap="2">
                {timeGroups.map(([groupKey, groupConversations]) => (
                  <Flex key={groupKey} direction="column">
                    <Flex
                      align="center"
                      style={{
                        height: 32,
                        padding: '0 var(--space-2)',
                      }}
                    >
                      <Text
                        size="1"
                        style={{
                          color: 'var(--slate-a9)',
                          fontWeight: 400,
                        }}
                      >
                        {TIME_GROUP_LABELS[groupKey]}
                      </Text>
                    </Flex>

                    <Flex direction="column" gap="1">
                      {groupConversations.map((conv) => (
                        <ChatRow
                          key={conv.id}
                          conversation={conv}
                          onClick={() => handleSelectConversation(conv.id)}
                          showDate={false}
                        />
                      ))}
                    </Flex>
                  </Flex>
                ))}

                {timeGroups.length === 0 && !conversationsLoading && (
                  <Flex align="center" justify="center" style={{ padding: 'var(--space-6)' }}>
                    <Text size="2" style={{ color: 'var(--slate-a9)' }}>
                      {"No chats yet"}
                    </Text>
                  </Flex>
                )}
              </Flex>
            )}
          </Box>
        </Flex>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
      `}</style>
    </Theme>
  );

  return createPortal(overlay, document.body);
}
