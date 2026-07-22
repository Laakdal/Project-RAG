'use client';

import React from 'react';
import { Flex, Text, TextField } from '@radix-ui/themes';
import { AvatarUploadWidget } from '../../components';
import { SettingsSection } from './settings-section';
import { SettingsRow } from './settings-row';

// ========================================
// Types
// ========================================

export interface GeneralSectionProps {
  avatarUrl: string | null;
  avatarInitial: string;
  avatarUploading: boolean;
  onEditAvatarClick: () => void;
  onDeleteAvatarClick: () => void;
  fullName: string;
  fullNameError?: string;
  onFullNameChange: (value: string) => void;
}

// ========================================
// Component
// ========================================

export function GeneralSection({
  avatarUrl,
  avatarInitial,
  avatarUploading,
  onEditAvatarClick,
  onDeleteAvatarClick,
  fullName,
  fullNameError,
  onFullNameChange,
}: GeneralSectionProps) {
  return (
    <SettingsSection title={"General"}>

      {/* Your Display Picture */}
      <SettingsRow
        label={"Your Display Picture"}
        description={"Recommended size is 256px by 256px"}
        control="end"
      >
        <AvatarUploadWidget
          src={avatarUrl}
          initial={avatarInitial}
          uploading={avatarUploading}
          onEditClick={onEditAvatarClick}
          onDeleteClick={onDeleteAvatarClick}
          triggerAriaLabel={"Edit profile picture"}
        />
      </SettingsRow>

      {/* Full Name */}
      <SettingsRow label={"Full Name"}>
        <Flex direction="column" gap="1">
          <TextField.Root
            placeholder={"eg: John Doe"}
            value={fullName}
            onChange={(e) => onFullNameChange(e.target.value)}
            color={fullNameError ? 'red' : undefined}
          />
          {fullNameError && (
            <Text size="1" style={{ color: 'var(--red-a11)' }}>
              {fullNameError}
            </Text>
          )}
        </Flex>
      </SettingsRow>

    </SettingsSection>
  );
}
