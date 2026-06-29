'use client';

import React from 'react';
import { Flex } from '@radix-ui/themes';
import { GuestGuard } from '@/app/components/ui/guest-guard';
import { SingleProvider } from '../forms';

export default function LoginPage() {
  return (
    <GuestGuard>
      {/* Single centered form on a plain background — no side hero. */}
      <Flex
        align="center"
        justify="center"
        style={{
          minHeight: '100dvh',
          width: '100%',
          backgroundColor: 'var(--color-background)',
          padding: '24px 20px',
        }}
      >
        <SingleProvider />
      </Flex>
    </GuestGuard>
  );
}
