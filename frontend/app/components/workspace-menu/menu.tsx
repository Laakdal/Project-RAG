'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, Flex, Box, Text, IconButton, VisuallyHidden } from '@radix-ui/themes';
import { signOut } from '@/lib/auth/session';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import ProfilePage from '@/workspace/profile/page';
import { POPUP_WIDTH } from './types';
import { SettingsSection } from './settings-section';
import { AppearancePanel } from './appearance-panel';
import { UserAvatar } from '@/app/components/ui/user-avatar';
import {
  useUserStore,
  selectFullName,
  selectUserEmail,
  selectAvatarUrl,
  selectIsAdmin,
} from '@/lib/store/user-store';

// ============================================
// Types
// ============================================

/** Which sub-panel is currently open (at most one) */
type ActiveSubPanel = null | 'appearance';

/** Which settings section is shown in the settings modal */
type SettingsTab = 'profile';

interface WorkspaceMenuProps {
  /** Whether the popup is visible */
  isOpen: boolean;
  /** Called when the popup should close */
  onClose: () => void;
  /** Ref to the trigger element so click-outside ignores it */
  triggerRef?: React.RefObject<HTMLElement | null>;
}

// ============================================
// Settings modal
// ============================================

interface SettingsNavItem {
  id: SettingsTab;
  icon: string;
  label: string;
}

const SETTINGS_NAV: SettingsNavItem[] = [
  { id: 'profile', icon: 'person', label: "Profile" },
];

interface SettingsNavButtonProps {
  item: SettingsNavItem;
  isActive: boolean;
  onClick: () => void;
}

/** Single row in the settings modal's left navigation. */
function SettingsNavButton({ item, isActive, onClick }: SettingsNavButtonProps) {
  const [isHovered, setIsHovered] = useState(false);
  const highlighted = isActive || isHovered;

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        appearance: 'none',
        margin: 0,
        font: 'inherit',
        outline: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        width: '100%',
        height: 34,
        padding: '0 10px',
        boxSizing: 'border-box',
        flexShrink: 0,
        // A soft filled pill for the active/hovered item — no outline, which
        // would read as a second frame inside the dialog's own border.
        borderRadius: 'var(--radius-3)',
        backgroundColor: highlighted ? 'var(--slate-a3)' : 'transparent',
        border: 'none',
        transition: 'background-color 120ms ease',
        cursor: 'pointer',
      }}
    >
      <MaterialIcon
        name={item.icon}
        size={17}
        color={isActive ? 'var(--slate-12)' : 'var(--slate-11)'}
      />
      <span
        style={{
          flex: 1,
          fontSize: 14,
          fontWeight: isActive ? 500 : 400,
          lineHeight: '20px',
          color: isActive ? 'var(--slate-12)' : 'var(--slate-11)',
          textAlign: 'left',
        }}
      >
        {item.label}
      </span>
    </button>
  );
}

interface WorkspaceSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Centered settings dialog.
 *
 * Left navigation + a scrollable content panel that reuses the existing
 * Profile settings page, plus an X to close.
 */
function WorkspaceSettingsModal({ open, onOpenChange }: WorkspaceSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {/* Dark overlay — matches the app's dialog pattern */}
      {open && (
        <Box
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(28, 32, 36, 0.5)',
            zIndex: 999,
            cursor: 'pointer',
          }}
          onClick={() => onOpenChange(false)}
        />
      )}

      <Dialog.Content
        style={{
          width: 'min(960px, 92vw)',
          maxWidth: 'min(960px, 92vw)',
          height: 'min(640px, 88vh)',
          padding: 0,
          background: 'var(--slate-2)',
          borderRadius: 'var(--radius-5)',
          border: '1px solid var(--olive-a3)',
          boxShadow:
            '0 16px 36px -20px var(--slate-a7, rgba(217, 237, 255, 0.25)), 0 16px 64px 0 var(--slate-a2, rgba(216, 244, 246, 0.04)), 0 12px 60px 0 var(--black-a3, rgba(0, 0, 0, 0.15))',
          zIndex: 1000,
          overflow: 'hidden',
        }}
      >
        <VisuallyHidden>
          <Dialog.Title>{"Settings"}</Dialog.Title>
        </VisuallyHidden>

        <Flex style={{ height: '100%', minHeight: 0 }}>
          {/* ── Left navigation ── */}
          <Flex
            direction="column"
            gap="1"
            style={{
              width: 212,
              flexShrink: 0,
              padding: 'var(--space-4) var(--space-2)',
              borderRight: '1px solid var(--olive-a3)',
              background: 'var(--slate-1)',
            }}
          >
            {/* Group label, not a dialog title — the pane's own heading names
                the section, so this just labels the list below it. */}
            <Text
              size="1"
              weight="medium"
              style={{
                color: 'var(--slate-11)',
                padding: '0 10px',
                marginBottom: 'var(--space-2)',
                letterSpacing: '0.02em',
              }}
            >
              {"Settings"}
            </Text>
            {SETTINGS_NAV.map((item) => (
              <SettingsNavButton
                key={item.id}
                item={item}
                isActive={activeTab === item.id}
                onClick={() => setActiveTab(item.id)}
              />
            ))}
          </Flex>

          {/* ── Content panel ── */}
          <Box style={{ flex: 1, minWidth: 0, position: 'relative' }}>
            {/* Close button */}
            <Dialog.Close>
              <IconButton
                variant="ghost"
                color="gray"
                size="2"
                type="button"
                aria-label={"Close settings"}
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  zIndex: 2,
                  cursor: 'pointer',
                }}
              >
                <MaterialIcon name="close" size={20} color="var(--slate-11)" />
              </IconButton>
            </Dialog.Close>

            {/* Scrollable settings content — reuses the Profile settings page */}
            <Box
              className="no-scrollbar"
              style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden' }}
            >
              <ProfilePage />
            </Box>
          </Box>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

// ============================================
// WorkspaceMenu
// ============================================

/**
 * Floating popup triggered from the sidebar footer button.
 *
 * Holds the settings entry (which opens the settings modal), the appearance
 * sub-panel, and logout.
 */
export function WorkspaceMenu({ isOpen, onClose, triggerRef }: WorkspaceMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [activePanel, setActivePanel] = useState<ActiveSubPanel>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Signed-in account, shown at the top of the popup.
  const fullName = useUserStore(selectFullName);
  const email = useUserStore(selectUserEmail);
  const avatarUrl = useUserStore(selectAvatarUrl);
  const isAdmin = useUserStore(selectIsAdmin) === true;
  const router = useRouter();

  // ── Close on click outside ──
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        !triggerRef?.current?.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    // Delay so the opening click doesn't immediately close
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // ── Close on Escape ──
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // ── Reset sub-panels when menu closes ──
  useEffect(() => {
    if (!isOpen) setActivePanel(null);
  }, [isOpen]);

  const togglePanel = (panel: 'appearance') => {
    setActivePanel((prev) => (prev === panel ? null : panel));
  };

  // ── Open the settings modal (from the menu's Settings entry) ──
  const openSettings = () => {
    onClose();
    setSettingsOpen(true);
  };

  // ── Admin-only: navigate to the admin user-management panel ──
  const openAdminUsers = () => {
    onClose();
    router.push('/workspace/users');
  };

  return (
    <>
      {/* Settings modal — lives outside the floating menu so it stays open
          after the menu closes. */}
      <WorkspaceSettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />

      {isOpen && (
        <Box
          ref={menuRef}
          style={{
            position: 'absolute',
            bottom: 60, // above the footer button
            left: 8,
            width: POPUP_WIDTH,
            borderRadius: 'var(--radius-1)',
            border: '1px solid var(--olive-3)',
            backgroundColor: 'var(--effects-translucent)',
            backdropFilter: 'blur(25px)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)',
            padding: '16px 8px',
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            fontFamily: 'Manrope, sans-serif',
          }}
        >
          {/* ── Signed-in account ── */}
          <Flex direction="column" gap="2">
            <Flex align="center" gap="2" style={{ padding: '0 8px', minWidth: 0 }}>
              <UserAvatar
                fullName={fullName}
                email={email}
                src={avatarUrl}
                size={32}
                radius="small"
              />
              <Box style={{ minWidth: 0 }}>
                <Text
                  size="2"
                  weight="medium"
                  style={{ color: 'var(--slate-12)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {fullName || email || 'Account'}
                </Text>
                {fullName && email && (
                  <Text
                    size="1"
                    style={{ color: 'var(--slate-11)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {email}
                  </Text>
                )}
              </Box>
            </Flex>
            <Box style={{ height: 1, background: 'var(--olive-3)' }} />
          </Flex>

          {/* ── Settings / Appearance / Logout ── */}
          <SettingsSection
            onWorkspaceSettings={openSettings}
            onAppearanceToggle={() => togglePanel('appearance')}
            isAppearanceActive={activePanel === 'appearance'}
            isAdmin={isAdmin}
            onAdminUsers={openAdminUsers}
            onLogout={() => {
              onClose();
              void signOut();
            }}
          />

          {/* ── Sub-panels — float to the right, top-aligned ── */}
          <AppearancePanel isOpen={activePanel === 'appearance'} />
        </Box>
      )}
    </>
  );
}
