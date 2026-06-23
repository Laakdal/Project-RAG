'use client';

import { useState, useRef } from 'react';
import { Flex, Box, Text } from '@radix-ui/themes';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import { UserAvatar } from '@/app/components/ui/user-avatar';
import { HEADER_ELEMENT_SIZE, ICON_SIZE_DEFAULT } from '@/app/components/sidebar';
import { WorkspaceMenu } from '@/app/components/workspace-menu';
import type { OrgInfo } from '@/app/components/workspace-menu';

/**
 * Sidebar footer — organisation selector button + popup menu.
 *
 * The org/branding endpoints (`/api/v1/org`, `/api/v1/org/logo`) do not exist
 * on the RAG backend, so we no longer fetch them — that probe 404'd and
 * surfaced a "Not Found" toast on chat load. The footer renders with no org
 * details (initials/blank), which is acceptable for this backend.
 */
export function ChatSidebarFooter() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [org] = useState<OrgInfo | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  const orgLogoUrl = org?.logoUrl ?? null;

  return (
    <Box style={{ padding: 'var(--space-2)', position: 'relative' }}>
      <WorkspaceMenu
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        org={org}
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
        {/* Org avatar — logo if available, else initial */}
        <UserAvatar
          fullName={org?.shortName || org?.registeredName}
          src={orgLogoUrl}
          size={HEADER_ELEMENT_SIZE}
          radius="small"
        />

        {/* Org name */}
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
          {org?.shortName || org?.registeredName}
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
