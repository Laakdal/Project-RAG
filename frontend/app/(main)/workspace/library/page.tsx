'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Box, Flex, Heading, Text, Button } from '@radix-ui/themes';
import { useUserStore, selectIsAdmin, selectIsProfileInitialized } from '@/lib/store/user-store';
import { useToastStore } from '@/lib/store/toast-store';
import { isProcessedError } from '@/lib/api';
import { LibraryApi, type LibraryStatus } from '@/lib/api/library';

function errorMessage(err: unknown, fallback: string): string {
  if (isProcessedError(err)) return err.message;
  return fallback;
}

export default function LibraryPage() {
  const router = useRouter();
  const isAdmin = useUserStore(selectIsAdmin);
  const initialized = useUserStore(selectIsProfileInitialized);
  const addToast = useToastStore((s) => s.addToast);

  const [status, setStatus] = useState<LibraryStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Send non-admins back to the app once the profile is known.
  useEffect(() => {
    if (initialized && isAdmin === false) router.replace('/chat/');
  }, [initialized, isAdmin, router]);

  const refresh = useCallback(async () => {
    try {
      setStatus(await LibraryApi.status());
    } catch (err) {
      addToast({ variant: 'error', title: 'Failed to load library status', description: errorMessage(err, '') });
    }
  }, [addToast]);

  useEffect(() => {
    if (isAdmin) void refresh();
  }, [isAdmin, refresh]);

  const onSync = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await LibraryApi.sync();
      addToast({
        variant: r.failed ? 'warning' : 'success',
        title: 'Library synced',
        description: `${r.added} added, ${r.updated} updated, ${r.deleted} removed, ${r.skipped} unchanged${r.failed ? `, ${r.failed} failed` : ''}.`,
      });
      await refresh();
    } catch (err) {
      addToast({ variant: 'error', title: 'Sync failed', description: errorMessage(err, 'Please try again.') });
    } finally {
      setSyncing(false);
    }
  }, [addToast, refresh]);

  if (!isAdmin) return null;

  return (
    <Box style={{ padding: 'var(--space-5)', maxWidth: 720 }}>
      <Heading size="6" mb="2">Library</Heading>
      <Text size="2" style={{ color: 'var(--gray-10)', display: 'block', marginBottom: 'var(--space-4)' }}>
        Index the shared Google Drive library for semantic search. Sync reads new and changed
        documents — including scanned files, which are OCR&apos;d — into the search index.
      </Text>

      <Flex align="center" gap="4">
        <Button onClick={onSync} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync library'}
        </Button>
        <Text size="2" style={{ color: 'var(--gray-10)' }}>
          {status
            ? `${status.total} indexed${status.failed ? `, ${status.failed} failed` : ''}${status.lastIndexedAt ? ` · last synced ${new Date(status.lastIndexedAt).toLocaleString()}` : ''}`
            : 'Loading status…'}
        </Text>
      </Flex>
    </Box>
  );
}
