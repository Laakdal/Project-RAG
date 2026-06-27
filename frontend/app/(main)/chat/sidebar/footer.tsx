'use client';

import { useState, useRef } from 'react';
import { Flex, Box, Text } from '@radix-ui/themes';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import { UserAvatar } from '@/app/components/ui/user-avatar';
import { HEADER_ELEMENT_SIZE, ICON_SIZE_DEFAULT } from '@/app/components/sidebar';
import { WorkspaceMenu } from '@/app/components/workspace-menu';
import {
  useUserStore,
  selectFullName,
  selectUserEmail,
  selectAvatarUrl,
} from '@/lib/store/user-store';

/**
 * Sidebar footer — account button + popup menu (settings, appearance, logout).
 */
export function ChatSidebarFooter() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);

  // Show the signed-in account rather than the app brand. UserAvatar derives
  // initials from fullName → email; avatarUrl is null in this build (no avatar
  // serving), so it renders initials. Fall back to email, then a neutral label
  // while the profile is still hydrating.
  const fullName = useUserStore(selectFullName);
  const email = useUserStore(selectUserEmail);
  const avatarUrl = useUserStore(selectAvatarUrl);
  const displayName = fullName || email || 'Account';

  return (
    <Box style={{ padding: 'var(--space-2)', position: 'relative' }}>
      <WorkspaceMenu
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        triggerRef={triggerRef}
      />

      <Flex
        ref={triggerRef}
        align="center"
        gap="2"
        onClick={() => setIsMenuOpen((prev) => !prev)}
        style={{
          width: '100%',
          height: 40,
          padding: 'var(--space-2)',
          background: 'var(--olive-2)',
          border: '1px solid var(--olive-3)',
          borderRadius: 'var(--radius-1)',
          cursor: 'pointer',
        }}
      >
        <UserAvatar
          fullName={fullName}
          email={email}
          src={avatarUrl}
          size={HEADER_ELEMENT_SIZE}
          radius="small"
        />

        <Text
          size="2"
          weight="medium"
          style={{
            flex: 1,
            textAlign: 'left',
            color: 'var(--emerald-12)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {displayName}
        </Text>

        <MaterialIcon
          name={isMenuOpen ? 'keyboard_arrow_down' : 'keyboard_arrow_up'}
          size={ICON_SIZE_DEFAULT}
          color="var(--slate-11)"
          style={{ userSelect: 'none' }}
        />
      </Flex>
    </Box>
  );
}
