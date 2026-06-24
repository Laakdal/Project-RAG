'use client';

import { useState, useEffect, useRef } from 'react';
import { Dialog, Flex, Box, Text, IconButton, VisuallyHidden } from '@radix-ui/themes';
import { signOut } from '@/lib/auth/session';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import { UserAvatar } from '@/app/components/ui/user-avatar';
import GeneralPage from '@/workspace/general/page';
import ProfilePage from '@/workspace/profile/page';
import type { OrgInfo } from './types';
import { POPUP_WIDTH } from './types';
import { Divider } from './menu-item';
import { SettingsSection } from './settings-section';
import { AppearancePanel } from './appearance-panel';

// ============================================
// Types
// ============================================

/** Which sub-panel is currently open (at most one) */
type ActiveSubPanel = null | 'appearance';

/** Which settings section is shown in the settings modal */
type SettingsTab = 'general' | 'profile';

interface WorkspaceMenuProps {
  /** Whether the popup is visible */
  isOpen: boolean;
  /** Called when the popup should close */
  onClose: () => void;
  /** Organisation details fetched at the page level */
  org: OrgInfo | null;
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
  { id: 'general', icon: 'business', label: "General" },
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
        height: 36,
        padding: '0 12px',
        boxSizing: 'border-box',
        flexShrink: 0,
        borderRadius: 'var(--radius-1)',
        backgroundColor: highlighted ? 'var(--olive-3)' : 'transparent',
        border: highlighted ? '1px solid var(--olive-4)' : '1px solid transparent',
        cursor: 'pointer',
      }}
    >
      <MaterialIcon
        name={item.icon}
        size={18}
        color={isActive ? 'var(--slate-12)' : 'var(--slate-11)'}
      />
      <span
        style={{
          flex: 1,
          fontSize: 14,
          fontWeight: 400,
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
 * Left navigation (General / Profile) + a scrollable content panel that reuses
 * the existing workspace settings pages, plus an X to close.
 */
function WorkspaceSettingsModal({ open, onOpenChange }: WorkspaceSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

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
              width: 220,
              flexShrink: 0,
              padding: 'var(--space-4) var(--space-3)',
              borderRight: '1px solid var(--olive-a3)',
              background: 'var(--slate-1)',
            }}
          >
            <Text
              size="3"
              weight="medium"
              style={{ color: 'var(--slate-12)', padding: '0 12px', marginBottom: 'var(--space-3)' }}
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

            {/* Scrollable settings content — reuses the workspace settings pages */}
            <Box
              className="no-scrollbar"
              style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden' }}
            >
              {activeTab === 'general' ? <GeneralPage /> : <ProfilePage />}
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
 * Composed of discrete sections (settings, external links, org),
 * with the organisation badge rendered directly here.
 */
export function WorkspaceMenu({ isOpen, onClose, org, triggerRef }: WorkspaceMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [activePanel, setActivePanel] = useState<ActiveSubPanel>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  const orgLogoUrl = org?.logoUrl ?? null;

  const togglePanel = (panel: 'appearance') => {
    setActivePanel((prev) => (prev === panel ? null : panel));
  };

  // ── Open the settings modal (from the menu's Settings entry) ──
  const openSettings = () => {
    onClose();
    setSettingsOpen(true);
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
          {/* ── Section 1: Settings ── */}
          <SettingsSection
            onWorkspaceSettings={openSettings}
            onAppearanceToggle={() => togglePanel('appearance')}
            isAppearanceActive={activePanel === 'appearance'}
            onLogout={() => {
              onClose();
              void signOut();
            }}
          />

          <Divider />

          {/* ── Section 2: Current Organisation ── */}
          {org && (
            <Flex direction="column" gap="3">
              {/* Org badge */}
              <Flex
                align="center"
                gap="2"
                style={{
                  height: 40,
                  padding: '0 8px',
                  // backgroundColor: 'var(--olive-2)',
                  // border: '1px solid var(--olive-3)',
                  borderRadius: 'var(--radius-1)',
                  flexShrink: 0,
                }}
              >
                {/* Org avatar badge */}
                <UserAvatar
                  fullName={org?.shortName || org?.registeredName}
                  src={orgLogoUrl}
                  size={24}
                  radius="small"
                />

                {/* Org name */}
                <Text
                  size="2"
                  weight="medium"
                  style={{
                    flex: 1,
                    color: 'var(--accent-12)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {org?.shortName || org?.registeredName}
                </Text>
              </Flex>
            </Flex>
          )}

          {/* ── Sub-panels — float to the right, top-aligned ── */}
          <AppearancePanel isOpen={activePanel === 'appearance'} />
        </Box>
      )}
    </>
  );
}
