'use client';

import React from 'react';
import { Flex } from '@radix-ui/themes';
import { SidebarBase } from '@/app/components/sidebar';
import { useChatStore } from '@/chat/store';
import { debugLog } from '@/chat/debug-logger';
import { useMobileSidebarStore } from '@/lib/store/mobile-sidebar-store';
import { useIsMobile } from '@/lib/hooks/use-is-mobile';
import { ChatSidebarHeader } from './header';
import { ChatSidebarFooter } from './footer';
import { StaticNavSection } from './static-nav-section';
import { ChatSections } from './chat-sections';
import { MoreChatsSidebar } from './more-chats-sidebar';

/**
 * Chat sidebar — uses SidebarBase shell with header, footer, and custom content.
 * When "More Chats" is opened, the secondary panel appears to the right
 * of the main sidebar via the `secondaryPanel` prop on SidebarBase.
 *
 * Wrapped in React.memo to prevent parent-cascade re-renders from
 * Next.js parallel-route page re-rendering during navigation.
 */
function ChatSidebar() {
  debugLog.tick('[sidebar] [ChatSidebar]');

  const isMoreChatsPanelOpen = useChatStore((s) => s.isMoreChatsPanelOpen);
  const moreChatsSectionType = useChatStore((s) => s.moreChatsSectionType);
  const toggleMoreChatsPanel = useChatStore((s) => s.toggleMoreChatsPanel);
  const closeMoreChatsPanel = useChatStore((s) => s.closeMoreChatsPanel);

  const isMobileOpen = useMobileSidebarStore((s) => s.isOpen);
  const closeMobileSidebar = useMobileSidebarStore((s) => s.close);
  const isMobile = useIsMobile();

  const secondaryPanel =
    isMoreChatsPanelOpen && moreChatsSectionType ? (
      <MoreChatsSidebar
        sectionType={moreChatsSectionType}
        onBack={closeMoreChatsPanel}
      />
    ) : undefined;

  return (
    <SidebarBase
      header={<ChatSidebarHeader />}
      footer={<ChatSidebarFooter />}
      secondaryPanel={secondaryPanel}
      onDismissSecondaryPanel={isMoreChatsPanelOpen ? closeMoreChatsPanel : undefined}
      isMobile={isMobile}
      mobileOpen={isMobileOpen}
      onMobileClose={closeMobileSidebar}
    >
      <Flex direction="column" gap="3">
        <StaticNavSection />
        <ChatSections onOpenMoreChats={toggleMoreChatsPanel} />
      </Flex>
    </SidebarBase>
  );
}

export default React.memo(ChatSidebar);
