'use client';

import React from 'react';
import { Flex, Box, Text } from '@radix-ui/themes';

export interface SettingsSectionProps {
  title?: string;
  description?: string;
  rightAction?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * A group of settings rows: a plain heading followed by its rows, separated by
 * hairlines. Deliberately borderless — boxing every group in a bordered card
 * fights with the dialog's own frame and makes a short settings pane look busy;
 * the heading plus the rule between rows carries the grouping on its own.
 */
export function SettingsSection({ title, description, rightAction, children }: SettingsSectionProps) {
  // Insert a divider between rows (never before the first or after the last),
  // skipping anything falsy a caller conditionally rendered.
  const rows = React.Children.toArray(children).filter(Boolean);

  return (
    <Flex direction="column" style={{ width: '100%' }}>
      {/* Section header — only rendered when title is provided */}
      {title && (
        <Flex align="center" justify="between" style={{ marginBottom: 'var(--space-2)' }}>
          <Flex direction="column" gap="1">
            <Text size="3" weight="bold" style={{ color: 'var(--gray-12)' }}>
              {title}
            </Text>
            {description && (
              <Text size="1" style={{ color: 'var(--gray-10)', lineHeight: '16px' }}>
                {description}
              </Text>
            )}
          </Flex>
          {rightAction}
        </Flex>
      )}

      {rows.map((row, i) => (
        <React.Fragment key={i}>
          {i > 0 && <Box style={{ height: 1, width: '100%', backgroundColor: 'var(--gray-a4)' }} />}
          {row}
        </React.Fragment>
      ))}
    </Flex>
  );
}
