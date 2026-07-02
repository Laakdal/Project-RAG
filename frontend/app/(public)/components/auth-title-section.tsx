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
  const resolvedTitle = title ?? 'Palmco GPT';
  const resolvedSubtitle =
    subtitle !== undefined
      ? subtitle
      : "Login Corporate Web.";
  return (
    <Box style={{ marginBottom }}>
      {/* ── Heading + subtitle (centered) ─────────────────────── */}
      <Flex direction="column" gap="1" align="center">
        <Text
          style={{
            color: 'var(--gray-12)',
            fontSize: '24px',
            fontWeight: 500,
            letterSpacing: '-0.1px',
            lineHeight: '30px',
            textAlign: 'center',
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
              textAlign: 'center',
            }}
          >
            {resolvedSubtitle}
          </Text>
        ) : null}
      </Flex>
    </Box>
  );
}
