'use client';

import { useState, useRef } from 'react';
import { Flex, Box, Text } from '@radix-ui/themes';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import { UserAvatar } from '@/app/components/ui/user-avatar';
import { HEADER_ELEMENT_SIZE, ICON_SIZE_DEFAULT } from '@/app/components/sidebar';
import { WorkspaceMenu } from '@/app/components/workspace-menu';

const APP_NAME = 'Project RAG';

/**
 * Sidebar footer — workspace button + popup menu (settings, appearance, logout).
 */
export function ChatSidebarFooter() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);

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
          fullName={APP_NAME}
          src={null}
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
          {APP_NAME}
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
