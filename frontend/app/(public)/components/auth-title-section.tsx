'use client';

import React from 'react';
import { Box, Flex, Text } from '@radix-ui/themes';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AuthTitleSectionProps {
  /** Main heading. Defaults to "Welcome to Project RAG". */
  title?: string;
  /** Subtitle below the heading. Defaults to the tagline. */
  subtitle?: string;
  /** Bottom margin below the full section. Defaults to "28px". */
  marginBottom?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * AuthTitleSection — reusable logo + heading + subtitle block
 * used at the top of every public-facing auth form.
 *
 * Matches the Figma node shared across sign-in, change-password, SSO, etc.
 */
export default function AuthTitleSection({
  title,
  subtitle,
  marginBottom = '28px',
}: AuthTitleSectionProps) {
  const resolvedTitle = title ?? 'Welcome to Project RAG';
  const resolvedSubtitle =
    subtitle !== undefined
      ? subtitle
      : "Your organization's knowledge, finally searchable and connected.";
  return (
    <Box style={{ marginBottom }}>
      {/* ── Heading + subtitle ────────────────────────────────── */}
      <Flex direction="column" gap="1">
        <Text
          style={{
            color: 'var(--gray-12)',
            fontSize: '24px',
            fontWeight: 500,
            letterSpacing: '-0.1px',
            lineHeight: '30px',
          }}
        >
          {resolvedTitle}
        </Text>
        {resolvedSubtitle ? (
          <Text
            style={{
              color: 'var(--gray-11)',
              fontSize: '14px',
              fontWeight: 400,
              lineHeight: '20px',
            }}
          >
            {resolvedSubtitle}
          </Text>
        ) : null}
      </Flex>
    </Box>
  );
}
