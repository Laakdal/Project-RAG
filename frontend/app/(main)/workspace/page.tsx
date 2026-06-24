'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * /workspace root — redirects to /workspace/profile
 */
export default function WorkspacePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/workspace/profile');
  }, [router]);

  return null;
}
