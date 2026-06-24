'use client';

import React from 'react';
import { Flex } from '@radix-ui/themes';
import { SharedAvatarStack } from './shared-avatar-stack';
import type { SharedAvatarMember } from './types';

interface ShareHeaderGroupProps {
  /** Shared members to show in avatar stack */
  members: SharedAvatarMember[];
  /** Called when an avatar in the stack is clicked */
  onShareClick: () => void;
  /** Max visible avatars (default: 3) */
  maxVisibleAvatars?: number;
}

export function ShareHeaderGroup({
  members,
  onShareClick,
  maxVisibleAvatars = 3,
}: ShareHeaderGroupProps) {
  // Share button removed; with no shared members there is nothing to show.
  if (members.length === 0) return null;

  return (
    <Flex align="center" gap="4">
      <SharedAvatarStack
        members={members}
        maxVisible={maxVisibleAvatars}
        onClick={onShareClick}
      />
    </Flex>
  );
}
