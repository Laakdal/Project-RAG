'use client';

import { useMemo } from 'react';
import { Flex } from '@radix-ui/themes';
import { ChatStarIcon } from '@/app/components/ui/chat-star-icon';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import { KBD_BADGE_PADDING, ICON_SIZE_DEFAULT } from '@/app/components/sidebar';
import { useCommandStore } from '@/lib/store/command-store';
import { useTranslation } from 'react-i18next';
import { getModifierSymbol } from '@/lib/utils/platform';
import { useIsMobile } from '@/lib/hooks/use-is-mobile';
import { useMobileSidebarStore } from '@/lib/store/mobile-sidebar-store';
import { SidebarItem } from './sidebar-item';

// ========================================
// Components
// ========================================

/** Keyboard shortcut badge */
const KbdBadge = ({ children }: { children: React.ReactNode }) => (
  <span
    style={{
      background: 'var(--slate-1)',
      border: '1px solid var(--slate-3)',
      padding: KBD_BADGE_PADDING,
      borderRadius: 'var(--radius-2)',
      fontSize: 12,
      lineHeight: 'var(--line-height-1)',
      letterSpacing: '0.04px',
      color: 'var(--slate-12)',
      fontWeight: 400,
    }}
  >
    {children}
  </span>
);

/**
 * Static navigation section — "New Chat" button and Search.
 */
export function StaticNavSection() {
  const dispatch = useCommandStore((s) => s.dispatch);
  const { t } = useTranslation();
  const modKey = useMemo(() => getModifierSymbol(), []);
  const isMobile = useIsMobile();
  const closeMobileSidebar = useMobileSidebarStore((s) => s.close);

  const handleNewChat = () => {
    if (isMobile) closeMobileSidebar();
    dispatch('newChat');
  };

  const handleOpenSearch = () => {
    dispatch('openCommandPalette');
  };

  return (
    <Flex direction="column" gap="1">
      {/* New Chat */}
      <SidebarItem
        icon={<ChatStarIcon size={ICON_SIZE_DEFAULT} color="var(--accent-a11)" />}
        label={t('chat.newChat')}
        onClick={handleNewChat}
        textColor="var(--accent-a11)"
        fontWeight={500}
      />
      {/* Search Chats — opens command palette (⌘+K) */}
      <SidebarItem
        icon={<MaterialIcon name={'search'} size={ICON_SIZE_DEFAULT} />}
        label={t('nav.searchChats')}
        onClick={handleOpenSearch}
        rightSlot={<KbdBadge>{modKey} +K</KbdBadge>}
      />
    </Flex>
  );
}
