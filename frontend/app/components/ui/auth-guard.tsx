'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Flex } from '@radix-ui/themes';
import { useAuthStore } from '@/lib/store/auth-store';
import { LottieLoader } from './lottie-loader';
import { DEV_BYPASS_AUTH } from '@/lib/dev/dev-bypass';

export function LoadingScreen() {
  return (
    <Flex
      align="center"
      justify="center"
      style={{ height: '100vh', width: '100%', backgroundColor: 'var(--olive-1)' }}
    >
      <LottieLoader variant="loader" size={64} />
    </Flex>
  );
}

/**
 * Blocks rendering of protected routes until auth state is resolved.
 *
 * - While the Zustand store is rehydrating from localStorage: shows a loading screen.
 * - Once hydrated and not authenticated: redirects to /login (loading screen prevents any flash).
 * - Once hydrated and authenticated: renders children.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  
  useEffect(() => {
    if (DEV_BYPASS_AUTH) return;
    if (!isHydrated) return;
    if (!isAuthenticated) {
      router.replace('/login');
    }
  }, [isHydrated, isAuthenticated, router]);

  if (!DEV_BYPASS_AUTH && (!isHydrated || !isAuthenticated)) {
    return <LoadingScreen />;
  }

  return <>{children}</>;
}
