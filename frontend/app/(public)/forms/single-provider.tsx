'use client';

import React, { useRef, useState } from 'react';
import { Box, Flex, Text, Callout } from '@radix-ui/themes';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'next/navigation';
import { isValidEmail } from '@/lib/utils/validators';
import { LoadingButton } from '@/app/components/ui/loading-button';
import AuthTitleSection from '../components/auth-title-section';
import { EmailField, PasswordField } from './form-components';
import { useAuthActions } from '../hooks/use-auth-actions';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SingleProviderProps {
  /** When true the title section (logo + heading) is not rendered. */
  hideTitle?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Email + password sign-in. Accounts are provisioned by an admin; users only
 * sign in (no self-service sign-up or password reset).
 */
export default function SingleProvider({ hideTitle = false }: SingleProviderProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordRequiredError, setPasswordRequiredError] = useState('');
  const searchParams = useSearchParams();
  const returnTo = searchParams.get('returnTo');
  const auth = useAuthActions({ email, redirectTo: returnTo ?? undefined });
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const ensureValidEmail = () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setEmailError(t('auth.common.emailRequired'));
      emailRef.current?.focus();
      return false;
    }
    if (!isValidEmail(trimmedEmail)) {
      setEmailError(t('auth.common.emailInvalid'));
      emailRef.current?.focus();
      return false;
    }
    if (emailError) setEmailError('');
    return true;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ensureValidEmail()) return;
    if (!password) {
      setPasswordRequiredError(t('auth.common.passwordRequired'));
      passwordRef.current?.focus();
      return;
    }
    setPasswordRequiredError('');
    auth.signInWithPassword(password);
  };

  const inlinePasswordError =
    passwordRequiredError ||
    (auth.error?.type === 'wrongPassword'
      ? t('auth.common.incorrectPassword')
      : auth.error?.type === 'noPasswordSet'
        ? t('auth.common.noPasswordSet')
        : undefined);

  return (
    <Box style={{ width: '100%', maxWidth: '440px' }}>
      {!hideTitle && <AuthTitleSection />}

      <form onSubmit={handleSubmit}>
        <Flex direction="column" gap="4">
          <EmailField
            ref={emailRef}
            value={email}
            onChange={(value) => {
              setEmail(value);
              if (emailError) setEmailError('');
              auth.clearError();
            }}
            error={emailError}
            autoFocus
          />

          <PasswordField
            ref={passwordRef}
            value={password}
            onChange={(v) => {
              setPassword(v);
              setPasswordRequiredError('');
              auth.clearError();
            }}
            error={inlinePasswordError}
          />

          {auth.error?.type === 'generic' && auth.error.message && (
            <Callout.Root color="red" size="1" variant="surface">
              <Callout.Text>
                <Text size="2">{auth.error.message}</Text>
              </Callout.Text>
            </Callout.Root>
          )}

          <LoadingButton
            type="submit"
            size="3"
            disabled={!password || !email.trim() || !isValidEmail(email.trim())}
            loading={auth.loading}
            loadingLabel={t('auth.common.signingIn')}
            style={{ flex: 1, backgroundColor: 'var(--accent-9)', color: 'white', fontWeight: 500 }}
          >
            {t('auth.common.signIn')}
          </LoadingButton>
        </Flex>
      </form>
    </Box>
  );
}
