'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AuthApi } from '../api';
import { applyAuthUser } from '@/lib/auth/session';
import { isProcessedError } from '@/lib/api';

export interface AuthError {
  type: 'wrongPassword' | 'generic';
  message?: string;
}

export interface UseAuthActionsOptions {
  /** Current email entered in the form. */
  email: string;
  /** Optional post-auth redirect destination. */
  redirectTo?: string;
}

/**
 * useAuthActions — email + password sign-in against the session backend.
 * On success the backend sets the session cookie and returns the user, which we
 * map into the auth + profile stores before redirecting.
 */
export function useAuthActions({ email, redirectTo }: UseAuthActionsOptions) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);

  const postAuthRedirectTo = redirectTo || '/chat';
  const clearError = useCallback(() => setError(null), []);

  const signInWithPassword = useCallback(
    async (password: string) => {
      if (loading || !password) return;
      setLoading(true);
      setError(null);
      try {
        const user = await AuthApi.login(email.trim(), password);
        applyAuthUser(user);
        if (typeof window !== 'undefined') {
          localStorage.setItem('pipeshub_last_email', email.trim());
        }
        router.push(postAuthRedirectTo);
      } catch (err: unknown) {
        const status = isProcessedError(err) ? err.statusCode : undefined;
        if (status === 401) {
          setError({ type: 'wrongPassword' });
        } else {
          setError({ type: 'generic', message: 'Sign in failed. Please try again.' });
        }
      } finally {
        setLoading(false);
      }
    },
    [email, loading, postAuthRedirectTo, router],
  );

  return { signInWithPassword, clearError, loading, error };
}
