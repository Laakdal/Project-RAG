'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Box, Button, Flex, Heading, Text, TextArea, TextField } from '@radix-ui/themes';
import { useUserStore, selectIsAdmin, selectIsProfileInitialized } from '@/lib/store/user-store';
import { useToastStore } from '@/lib/store/toast-store';
import { isProcessedError } from '@/lib/api';
import { SettingsApi, type ManagedSetting } from '@/lib/api/settings';

function errorMessage(err: unknown, fallback: string): string {
  if (isProcessedError(err)) return err.message;
  return fallback;
}

function SourceBadge({ setting }: { setting: ManagedSetting }) {
  if (setting.source === 'db') return <Badge color="green">Set</Badge>;
  if (setting.source === 'env') return <Badge color="gray">From env</Badge>;
  return <Badge color="orange">Not set</Badge>;
}

export default function SettingsPage() {
  const router = useRouter();
  const isAdmin = useUserStore(selectIsAdmin);
  const initialized = useUserStore(selectIsProfileInitialized);
  const addToast = useToastStore((s) => s.addToast);

  const [settings, setSettings] = useState<ManagedSetting[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Non-secret fields are editable in place; secret fields start blank (the
  // value is never sent to the client — typing a new one replaces it).
  const seedDrafts = useCallback((list: ManagedSetting[]) => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const s of list) next[s.key] = s.secret ? '' : (s.value ?? '');
      return next;
    });
  }, []);

  useEffect(() => {
    if (initialized && isAdmin === false) router.replace('/chat/');
  }, [initialized, isAdmin, router]);

  const refresh = useCallback(async () => {
    try {
      const list = await SettingsApi.list();
      setSettings(list);
      seedDrafts(list);
    } catch (err) {
      addToast({ variant: 'error', title: 'Failed to load settings', description: errorMessage(err, '') });
    }
  }, [addToast, seedDrafts]);

  useEffect(() => {
    if (isAdmin) void refresh();
  }, [isAdmin, refresh]);

  const onSave = useCallback(
    async (setting: ManagedSetting) => {
      const value = drafts[setting.key] ?? '';
      if (setting.secret && value.trim() === '') {
        addToast({ variant: 'warning', title: 'Nothing to save', description: 'Enter a value to update this secret.' });
        return;
      }
      setSavingKey(setting.key);
      try {
        const list = await SettingsApi.update(setting.key, value);
        setSettings(list);
        seedDrafts(list);
        addToast({ variant: 'success', title: 'Saved', description: `${setting.label} updated.` });
      } catch (err) {
        addToast({ variant: 'error', title: 'Save failed', description: errorMessage(err, 'Please try again.') });
      } finally {
        setSavingKey(null);
      }
    },
    [drafts, addToast, seedDrafts],
  );

  if (!isAdmin) return null;

  return (
    <Box style={{ padding: 'var(--space-5)', maxWidth: 760, margin: '0 auto' }}>
      <Heading size="6" mb="2">Integrations &amp; Tokens</Heading>
      <Text size="2" style={{ color: 'var(--gray-10)', display: 'block', marginBottom: 'var(--space-5)' }}>
        Google Drive and internal tokens. A value saved here overrides the server environment
        immediately — no redeploy. Secrets are write-only: they are never shown again, only their
        set/unset status. LLM providers and models are managed under API Connections.
      </Text>

      <Flex direction="column" gap="5">
        {settings.map((s) => (
          <Box key={s.key}>
            <Flex align="center" justify="between" mb="1">
              <Flex align="center" gap="2">
                <Text size="2" weight="medium">{s.label}</Text>
                <SourceBadge setting={s} />
              </Flex>
              <Text size="1" style={{ color: 'var(--gray-9)', fontFamily: 'monospace' }}>{s.key}</Text>
            </Flex>

            <Flex gap="2" align="start">
              {s.multiline ? (
                <TextArea
                  style={{ flex: 1, minHeight: 90, fontFamily: 'monospace' }}
                  placeholder={s.isSet ? '•••••••••• (set — paste new JSON to replace)' : 'Paste the service-account JSON'}
                  value={drafts[s.key] ?? ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: e.target.value }))}
                />
              ) : (
                <TextField.Root
                  style={{ flex: 1 }}
                  type={s.secret ? 'password' : 'text'}
                  placeholder={
                    s.secret
                      ? s.isSet
                        ? '•••••••••• (set — type to replace)'
                        : 'Not set — paste value'
                      : 'Not set'
                  }
                  value={drafts[s.key] ?? ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: e.target.value }))}
                />
              )}
              <Button
                onClick={() => void onSave(s)}
                disabled={savingKey === s.key}
                variant="soft"
              >
                {savingKey === s.key ? 'Saving…' : 'Save'}
              </Button>
            </Flex>
          </Box>
        ))}
      </Flex>
    </Box>
  );
}
