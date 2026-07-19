'use client'

import { Box, Flex, IconButton, Text } from '@radix-ui/themes'
import { ReactNode, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useIsMobile } from '@/lib/hooks/use-is-mobile'
import { MaterialIcon } from '@/app/components/ui/MaterialIcon'
import WorkspaceSidebar from './sidebar'

/**
 * Workspace settings shell: left drawer + scrollable page area.
 *
 * On desktop the sidebar is a fixed left column. On mobile (≤768px) it collapses
 * into a slide-in drawer: the column is hidden and a sticky top bar with a
 * hamburger opens it as a full-screen overlay (handled by SidebarBase). The
 * drawer auto-closes on navigation so a tap on a nav item lands on the page.
 */
export default function WorkspaceLayout({
  children,
}: {
  children: ReactNode
}) {
  const isMobile = useIsMobile()
  const [navOpen, setNavOpen] = useState(false)
  const pathname = usePathname()

  // Close the drawer whenever the route changes (i.e. a nav item was tapped).
  useEffect(() => {
    setNavOpen(false)
  }, [pathname])

  return (
    <Flex style={{ height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <WorkspaceSidebar
        isMobile={isMobile}
        mobileOpen={navOpen}
        onMobileClose={() => setNavOpen(false)}
      />
      <Box
        className="no-scrollbar"
        style={{
          flex: 1,
          minWidth: 0,
          height: '100%',
          overflowY: 'auto',
          overflowX: 'hidden',
          background:
            'linear-gradient(180deg, var(--olive-2, #181917) 0%, var(--olive-1, #111210) 100%)',
        }}
      >
        {/* Mobile-only top bar: hamburger opens the settings drawer. */}
        {isMobile && (
          <Flex
            align="center"
            gap="2"
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 10,
              padding: '8px 12px',
              borderBottom: '1px solid var(--olive-a4)',
              background: 'var(--olive-2)',
            }}
          >
            <IconButton
              variant="ghost"
              color="gray"
              onClick={() => setNavOpen(true)}
              aria-label="Open settings menu"
              style={{ cursor: 'pointer' }}
            >
              <MaterialIcon name="menu" size={22} color="var(--gray-11)" />
            </IconButton>
            <Text size="2" weight="medium" style={{ color: 'var(--gray-12)' }}>
              {'Settings'}
            </Text>
          </Flex>
        )}
        {children}
      </Box>
    </Flex>
  )
}
