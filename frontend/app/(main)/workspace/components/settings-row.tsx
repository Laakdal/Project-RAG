'use client';

import React from 'react';
import { Flex, Box, Text } from '@radix-ui/themes';

export interface SettingsRowProps {
  label: string;
  description?: string;
  /** How the control uses its column: 'fill' for inputs that should span it,
   *  'end' for a compact control (avatar, button) that hugs the right edge. */
  control?: 'fill' | 'end';
  children: React.ReactNode;
}

/** Width of the control column. Inputs fill it; smaller controls (an avatar, a
 *  button) sit flush to its right edge, so every control in a section lines up
 *  on the same axis regardless of its size. */
const CONTROL_WIDTH = 240;

/**
 * One setting: label (and optional hint) on the left, its control right-aligned.
 * Rows are a uniform height so a column of them reads as an even list.
 */
export function SettingsRow({ label, description, control = 'fill', children }: SettingsRowProps) {
  return (
    <Flex
      align="center"
      justify="between"
      gap="4"
      style={{ width: '100%', minHeight: 56, padding: 'var(--space-2) 0' }}
    >
      {/* Left: label + description */}
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text size="2" weight="medium" style={{ color: 'var(--gray-12)', display: 'block' }}>
          {label}
        </Text>
        {description && (
          <Text
            size="1"
            style={{
              color: 'var(--gray-10)',
              display: 'block',
              marginTop: 2,
              lineHeight: '16px',
            }}
          >
            {description}
          </Text>
        )}
      </Box>
      {/* Right: the control, right-aligned in a fixed column */}
      <Flex justify="end" style={{ flex: `0 1 ${CONTROL_WIDTH}px`, minWidth: 0 }}>
        <Box style={control === 'fill' ? { width: '100%' } : undefined}>{children}</Box>
      </Flex>
    </Flex>
  );
}
