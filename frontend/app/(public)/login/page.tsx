'use client';

import React from 'react';
import { Flex } from '@radix-ui/themes';
import { GuestGuard } from '@/app/components/ui/guest-guard';
import { useAuthWideLayout } from '@/lib/hooks/use-breakpoint';
import AuthHero from '../components/auth-hero';
import FormPanel from '../components/form-panel';
import { SingleProvider } from '../forms';

/**
 * Login — email + password only. Accounts are created by an admin; there is no
 * self-service sign-up or password reset.
 */
export default function LoginPage() {
  const splitLayout = useAuthWideLayout();

  return (
    <GuestGuard>
      <Flex
        direction={splitLayout ? 'row' : 'column'}
        style={{
          minHeight: '100dvh',
          overflow: splitLayout ? 'hidden' : undefined,
        }}
      >
        <AuthHero splitLayout={splitLayout} />
        <FormPanel splitLayout={splitLayout}>
          <SingleProvider />
        </FormPanel>
      </Flex>
    </GuestGuard>
  );
}
