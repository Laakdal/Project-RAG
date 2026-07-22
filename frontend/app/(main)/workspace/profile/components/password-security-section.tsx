'use client';

import React, { useState } from 'react';
import { Button } from '@radix-ui/themes';
import { SettingsSection } from './settings-section';
import { SettingsRow } from './settings-row';

// ========================================
// Types
// ========================================

export interface PasswordSecuritySectionProps {
  onChangePasswordClick: () => void;
}

// ========================================
// Component
// ========================================

export function PasswordSecuritySection({ onChangePasswordClick }: PasswordSecuritySectionProps) {
  const [btnHovered, setBtnHovered] = useState(false);

  return (
    <SettingsSection title={"Password & Security"}>
      {/* A plain label/control row like every other setting — the icon tile it
          used to carry was the only one in the pane and broke the row rhythm. */}
      <SettingsRow
        label={"Account Password"}
        description={"Please follow the instructions in the email to finish setting your password"}
        control="end"
      >
        <Button
          type="button"
          onClick={onChangePasswordClick}
          onMouseEnter={() => setBtnHovered(true)}
          onMouseLeave={() => setBtnHovered(false)}
          variant="solid"
          size="2"
          style={{
            backgroundColor: btnHovered ? 'var(--slate-a4)' : 'var(--slate-a3)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {"Change Password"}
        </Button>
      </SettingsRow>
    </SettingsSection>
  );
}
