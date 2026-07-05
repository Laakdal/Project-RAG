'use client';

import { Flex, IconButton, Text, Tooltip } from '@radix-ui/themes';
import { HEADER_ELEMENT_SIZE } from '@/app/components/sidebar';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import { useSidebarWidthStore } from '@/lib/store/sidebar-width-store';
import { useIsMobile } from '@/lib/hooks/use-is-mobile';

/**
 * Sidebar header — logo and a desktop collapse button.
 * When the sidebar is collapsed the header is not visible (sidebar is 0-wide),
 * so we only need to handle the expanded state here.
 */
export function ChatSidebarHeader() {
  const setNavCollapsed = useSidebarWidthStore((s) => s.setNavCollapsed);
  const isMobile = useIsMobile();

  return (
    <Flex align="center" justify="between" gap="2" style={{ height: '100%', padding: 'var(--space-4)' }}>
      <Flex align="center" gap="2" style={{ minWidth: 0 }}>
        <img
          src="/logo.png"
          alt=""
          width={HEADER_ELEMENT_SIZE}
          height={HEADER_ELEMENT_SIZE}
          style={{ borderRadius: 'var(--radius-2)', flexShrink: 0, objectFit: 'cover' }}
        />
        <Text
          as="span"
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--slate-12)',
            lineHeight: 1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {"Palmco GPT"}
        </Text>
      </Flex>
      <Flex align="center" gap="2" style={{ flexShrink: 0 }}>
        {!isMobile && (
          <Tooltip content="Collapse sidebar" side="right">
            <IconButton
              variant="ghost"
              color="gray"
              size="1"
              aria-label="Collapse sidebar"
              onClick={() => setNavCollapsed(true)}
              style={{ margin: 0, cursor: 'pointer' }}
            >
              <MaterialIcon name="keyboard_tab" size={18} color="var(--gray-10)" style={{ transform: 'scaleX(-1)' }} />
            </IconButton>
          </Tooltip>
        )}
      </Flex>
    </Flex>
  );
}
