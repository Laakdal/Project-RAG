'use client';

import React from 'react';
import { Box } from '@radix-ui/themes';

// ─── Component ────────────────────────────────────────────────────────────────

export interface AuthHeroProps {
  /** When false, the hero is hidden (narrow / stacked auth shell). */
  splitLayout: boolean;
}

/**
 * AuthHero — the dark panel shown beside the auth form on public pages.
 * Renders the world-map background only (the marketing heading, search pill,
 * and connector graphic were removed).
 */
export default function AuthHero({ splitLayout }: AuthHeroProps) {
  if (!splitLayout) return null;

  return (
    <Box
      style={{
        position: 'relative',
        flex: '0 0 57%',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: '#0a0a0c',
      }}
    >
      {/* ── Background image ─────────────────────────────────────── */}
      <img
        src="/login-page-assets/bg/login-page.png"
        alt=""
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: 'center',
          pointerEvents: 'none',
        }}
      />

      {/* ── Dark overlay (subtle tint over the background) ────────── */}
      <Box
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.2)',
          pointerEvents: 'none',
        }}
      />
    </Box>
  );
}
