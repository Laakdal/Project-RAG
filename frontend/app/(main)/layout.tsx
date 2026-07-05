'use client'

import React, { useEffect } from "react"
import "../globals.css"
import 'react-pdf-highlighter/dist/esm/style/PdfHighlighter.css';
import 'react-pdf-highlighter/dist/esm/style/Highlight.css';
import 'react-pdf-highlighter/dist/esm/style/AreaHighlight.css';
import 'react-pdf-highlighter/dist/esm/style/Tip.css';
import 'react-pdf-highlighter/dist/esm/style/MouseSelection.css';
import { Flex, Box, Text, IconButton } from "@radix-ui/themes"
import { MaterialIcon } from "../components/ui/MaterialIcon"
import { ThemeProvider, ThemeScript } from "../components/theme-provider"
import { SWRConfig } from "swr"
import { axiosFetcher } from "@/lib/api"
import { logoutAndRedirect } from "@/lib/store/auth-store"
import { UploadProgressTracker } from "../components/upload-progress-tracker"
import { ToastContainer } from "../components/feedback"
import { UserProfileInitializer } from './components/user-profile-initializer'
import { useMobileSidebarStore } from "@/lib/store/mobile-sidebar-store"
import { useSidebarWidthStore } from "@/lib/store/sidebar-width-store"
import { useIsMobile } from "@/lib/hooks/use-is-mobile"
import { AuthGuard } from '@/app/components/ui/auth-guard'
import { AuthHydrator } from '@/lib/store/auth-hydrator'
import { ServerUrlGuard } from '@/app/components/electron/server-url-setup'

// Extra pixels beyond sidebarWidth needed to accommodate the "More Chats"
// secondary panel that SidebarBase adds when open (it widens the cluster).
// If the secondary panel ever grows, update this constant.
const SIDEBAR_SECONDARY_PANEL_EXTRA_PX = 300;

export default function RootLayout({
  children,
  sidebar,
}: {
  children: React.ReactNode
  sidebar: React.ReactNode
}) {
  useEffect(() => {
    document.title = "Palmco GPT"
  }, [])

  // Auth enforcement: the <AuthGuard> component below handles the initial
  // auth check and redirects unauthenticated users to /login.
  // The axios interceptor in lib/api/axios-instance.ts also handles session
  // expiry at runtime: any 401 triggers a token refresh attempt; on failure
  // it calls logoutAndRedirect() which clears auth state and sends the user
  // to /login.
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
        <link
          href="https://fonts.googleapis.com/icon?family=Material+Icons+Outlined|Material+Icons"
          rel="stylesheet"
        />
      </head>
      <body style={{ backgroundColor: 'var(--olive-1, #f8f8f5)' }}>
        <ThemeProvider>
            <AuthHydrator />
            {/* Landscape block — pure CSS visibility, no JS */}
            <div className="landscape-block-overlay">
              <MaterialIcon name="screen_rotation" size={48} color="var(--gray-11)" />
              <Text size="3" style={{ color: 'var(--gray-11)', maxWidth: '220px' }}>
                {"Rotate your device for the best experience"}
              </Text>
            </div>
            <ServerUrlGuard>
              <AuthGuard>
                <AppLayout sidebar={sidebar}>
                  {children}
                </AppLayout>
              </AuthGuard>
            </ServerUrlGuard>
            <ToastContainer />
          </ThemeProvider>
      </body>
    </html>
  )
}

// Main app shell — auth is gated by <AuthGuard> (redirects to /login if not authenticated),
// with runtime session expiry handled by the axios interceptor (401 → refresh → redirect to login)
function AppLayout({
  children,
  sidebar,
}: {
  children: React.ReactNode
  sidebar: React.ReactNode
}) {
  const openMobileSidebar = useMobileSidebarStore((s) => s.open)
  const isMobile = useIsMobile()
  const sidebarWidth = useSidebarWidthStore((s) => s.sidebarWidth)
  const isNavCollapsed = useSidebarWidthStore((s) => s.isNavCollapsed)
  const setNavCollapsed = useSidebarWidthStore((s) => s.setNavCollapsed)

  return (
    <SWRConfig
      value={{
        fetcher: axiosFetcher,
        onError: (error) => {
          if (error?.type === 'AUTHENTICATION_ERROR') {
            logoutAndRedirect()
          }
        },
      }}
    >
      {/* Hydrates user profile (name, email, isAdmin, avatar) once auth is ready */}
      <UserProfileInitializer />
      <Flex
        style={{
          height: '100vh',
          width: '100%',
          overflow: 'hidden',
          backgroundColor: 'var(--slate-2)',
        }}
      >
        {/* Sidebar slot — on desktop renders inline with a collapsible animation;
            on mobile the sidebar component itself renders as a fixed overlay
            (controlled via useMobileSidebarStore). */}
        {/* Sidebar wrapper — animates to 0 on desktop collapse so the main
            content fills the full viewport. The toggle to restore it lives
            inside the main content area (not fixed here) to avoid overlapping
            page headers. max-width is used so the secondary-panel cluster
            (More Chats) which SidebarBase widens is not clipped. */}
        <Box
          key="app-sidebar-slot"
          data-ph-sidebar-slot=""
          style={{
            maxWidth: (!isMobile && isNavCollapsed)
              ? 0
              : `${sidebarWidth + SIDEBAR_SECONDARY_PANEL_EXTRA_PX}px`,
            flexShrink: 0,
            transition: 'max-width 0.28s cubic-bezier(0.4, 0, 0.2, 1)',
            position: 'relative',
            // Must be an explicit height so the SidebarBase's height:'100%'
            // chain resolves correctly (this Box is a flex child of the outer
            // 100vh Flex, so align-self:stretch already makes it full-height;
            // the explicit value ensures children can inherit it).
            height: '100%',
          }}
        >
          {sidebar}
        </Box>

        {/* Main content area — zIndex: 0 creates a stacking context so
            page-internal z-indexes don't compete with the sidebar's
            secondary panel (zIndex: 10 in root context). */}
        <Flex
          key="app-main-column"
          direction="column"
          data-main-content
          style={{ flex: 1, overflow: 'hidden', zIndex: 0, position: 'relative' }}
        >
          {/* Mobile hamburger — fixed top-left, only visible on mobile.
              On desktop the icon rail always shows a toggle, so no floating button needed. */}
          {isMobile && (
            <Box
              key="app-mobile-menu-anchor"
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                height: '40px',
                display: 'flex',
                alignItems: 'center',
                paddingLeft: 'var(--space-3)',
                zIndex: 100,
              }}
            >
              <IconButton
                variant="ghost"
                color="gray"
                size="2"
                onClick={openMobileSidebar}
                style={{ margin: 0 }}
                aria-label="Open sidebar"
              >
                <MaterialIcon name="menu" size={22} color="var(--gray-11)" />
              </IconButton>
            </Box>
          )}
          <Box
            key="app-main-scroll"
            data-app-main-scroll
            className="no-scrollbar"
            style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}
          >
            {children}
          </Box>
        </Flex>

        <UploadProgressTracker key="upload-progress-tracker" />
      </Flex>
    </SWRConfig>
  )
}
