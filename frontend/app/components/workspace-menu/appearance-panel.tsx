'use client';

import {
  useThemeAppearance,
  type ThemePreference,
} from '@/app/components/theme-provider';
import { SubPanel, SubPanelItem } from './sub-panel';

interface AppearancePanelProps {
  isOpen: boolean;
}

/**
 * Floating sub-panel for choosing appearance mode.
 * Options: System, Light, Dark.
 */
export function AppearancePanel({ isOpen }: AppearancePanelProps) {
  const { preference, setPreference } = useThemeAppearance();

  const APPEARANCE_OPTIONS: { value: ThemePreference; label: string; icon: string }[] = [
    { value: 'system', label: "System", icon: 'toggle_off' },
    { value: 'light', label: "Light", icon: 'light_mode' },
    { value: 'dark', label: "Dark", icon: 'mode_night' },
  ];

  return (
    <SubPanel isOpen={isOpen}>
      {APPEARANCE_OPTIONS.map((opt) => (
        <SubPanelItem
          key={opt.value}
          icon={opt.icon}
          label={opt.label}
          isActive={preference === opt.value}
          onClick={() => setPreference(opt.value)}
        />
      ))}
    </SubPanel>
  );
}
