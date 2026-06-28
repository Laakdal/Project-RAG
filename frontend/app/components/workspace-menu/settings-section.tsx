'use client';

import { Flex, Text } from '@radix-ui/themes';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import { ICON_SIZE_DEFAULT } from '@/app/components/sidebar';
import { useThemeAppearance } from '@/app/components/theme-provider';

import { useIsMobile } from '@/lib/hooks/use-is-mobile';
import { MenuItem } from './menu-item';

interface SettingsSectionProps {
  onWorkspaceSettings: () => void;
  onAppearanceToggle: () => void;
  isAppearanceActive: boolean;
  onLogout: () => void;
  /** Admin-only: when true, show the "Users" entry that opens the admin panel. */
  isAdmin?: boolean;
  onAdminUsers?: () => void;
}

/** Icon for appearance: shows current mode icon */
function AppearanceIcon({ color }: { color: string }) {
  const { appearance } = useThemeAppearance();
  return (
    <MaterialIcon
      name={appearance === 'dark' ? 'dark_mode' : 'light_mode'}
      size={ICON_SIZE_DEFAULT}
      color={color}
    />
  );
}

/**
 * Top section of the workspace menu:
 *   Appearance, Settings, Language, Log Out
 */
export function SettingsSection({
  onWorkspaceSettings,
  onAppearanceToggle,
  isAppearanceActive,
  onLogout,
  isAdmin,
  onAdminUsers,
}: SettingsSectionProps) {
  const isMobile = useIsMobile();
  const { appearance } = useThemeAppearance();

  const appearanceLabel = appearance === 'dark' ? "Dark Mode" : "Light Mode";

  return (
    <Flex direction="column" gap="1">
      <MenuItem
        icon={
          <AppearanceIcon
            color={isAppearanceActive ? 'var(--slate-12)' : 'var(--slate-11)'}
          />
        }
        label={
          <Flex align="center" gap="1">
            {"Appearance"}
            <Text style={{ color: 'var(--slate-6)' }}>•</Text>
            <Text size="2" weight="medium" style={{ color: 'var(--slate-10)' }}>{appearanceLabel}</Text>
          </Flex>
        }
        isActive={isAppearanceActive}
        rightSlot={
          <MaterialIcon
            name="chevron_right"
            size={ICON_SIZE_DEFAULT}
            color={isAppearanceActive ? 'var(--slate-12)' : 'var(--slate-11)'}
          />
        }
        onClick={onAppearanceToggle}
      />

      {!isMobile && (
        <MenuItem
          icon={
            <MaterialIcon
              name="settings"
              size={ICON_SIZE_DEFAULT}
              color="var(--slate-11)"
            />
          }
          label={"Settings"}
          onClick={onWorkspaceSettings}
        />
      )}

      {isAdmin && onAdminUsers && (
        <MenuItem
          icon={
            <MaterialIcon
              name="group"
              size={ICON_SIZE_DEFAULT}
              color="var(--slate-11)"
            />
          }
          label={"Admin panel"}
          onClick={onAdminUsers}
        />
      )}

      <MenuItem
        icon={
          <MaterialIcon
            name="logout"
            size={ICON_SIZE_DEFAULT}
            color="var(--red-11)"
          />
        }
        label={"Log Out"}
        textColor="var(--red-11)"
        onClick={onLogout}
      />
    </Flex>
  );
}
