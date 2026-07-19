'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Box, Button, Card, Dialog, Flex, Heading, Text, TextArea, TextField } from '@radix-ui/themes';
import { SettingsSection } from '../components';
import { useUserStore, selectIsAdmin, selectIsProfileInitialized } from '@/lib/store/user-store';
import { useToastStore } from '@/lib/store/toast-store';
import { isProcessedError } from '@/lib/api';
import { SettingsApi, type ManagedSetting } from '@/lib/api/settings';
import { DriveSourcesApi, type DriveSource, type DriveSourceInput } from '@/lib/api/drive-sources';

const EMPTY_SOURCE: DriveSourceInput = { name: '', clientId: '', clientSecret: '', folderId: '' };

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

  const [sources, setSources] = useState<DriveSource[]>([]);
  const [redirectUrl, setRedirectUrl] = useState('');
  const [srcEditing, setSrcEditing] = useState<string | 'new' | null>(null);
  const [srcForm, setSrcForm] = useState<DriveSourceInput>(EMPTY_SOURCE);
  const [srcBusy, setSrcBusy] = useState(false);

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

  const loadSources = useCallback(async () => {
    try {
      const data = await DriveSourcesApi.get();
      setSources(data.sources);
      setRedirectUrl(data.redirectUrl);
    } catch (err) {
      addToast({ variant: 'error', title: 'Failed to load Drive sources', description: errorMessage(err, '') });
    }
  }, [addToast]);

  useEffect(() => {
    if (isAdmin) {
      void refresh();
      void loadSources();
    }
  }, [isAdmin, refresh, loadSources]);

  // Toast the result of returning from the Google OAuth flow (?drive=...).
  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get('drive');
    if (!status) return;
    if (status === 'connected') addToast({ variant: 'success', title: 'Google account connected' });
    else addToast({ variant: 'error', title: 'Google sign-in failed', description: status });
    window.history.replaceState(null, '', window.location.pathname);
  }, [addToast]);

  const openNewSource = () => {
    setSrcForm(EMPTY_SOURCE);
    setSrcEditing('new');
  };
  const openEditSource = (s: DriveSource) => {
    setSrcForm({ name: s.name, clientId: s.clientId, clientSecret: '', folderId: s.folderId });
    setSrcEditing(s.id);
  };

  const signIn = useCallback(
    async (s: DriveSource) => {
      try {
        window.location.href = await DriveSourcesApi.authorizeUrl(s.id);
      } catch (err) {
        addToast({ variant: 'error', title: 'Could not start sign-in', description: errorMessage(err, '') });
      }
    },
    [addToast],
  );

  const saveSource = useCallback(async () => {
    if (!srcForm.name || !srcForm.clientId || (srcEditing === 'new' && !srcForm.clientSecret)) {
      addToast({
        variant: 'warning',
        title: 'Missing fields',
        description: 'Name, Client ID and (for a new source) the Client Secret are required.',
      });
      return;
    }
    setSrcBusy(true);
    try {
      const next =
        srcEditing === 'new'
          ? await DriveSourcesApi.create(srcForm)
          : await DriveSourcesApi.update(srcEditing as string, srcForm);
      setSources(next);
      setSrcEditing(null);
      addToast({ variant: 'success', title: 'Drive source saved' });
    } catch (err) {
      addToast({ variant: 'error', title: 'Save failed', description: errorMessage(err, 'Please try again.') });
    } finally {
      setSrcBusy(false);
    }
  }, [srcForm, srcEditing, addToast]);

  const removeSource = useCallback(
    async (s: DriveSource) => {
      setSrcBusy(true);
      try {
        setSources(await DriveSourcesApi.remove(s.id));
        addToast({ variant: 'success', title: 'Drive source deleted', description: s.name });
      } catch (err) {
        addToast({ variant: 'error', title: 'Delete failed', description: errorMessage(err, '') });
      } finally {
        setSrcBusy(false);
      }
    },
    [addToast],
  );

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

      <SettingsSection
        title="Google Drive & Tokens"
        description="Credentials the RAG pipeline uses to reach Google Drive and internal endpoints."
      >
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
      </SettingsSection>

      <Box mt="4">
        <SettingsSection
          title="Drive Sources"
          description="Each Google account to search, connected with Sign in with Google. Drive lookup searches all connected accounts."
          rightAction={<Button onClick={openNewSource} disabled={srcEditing !== null}>+ Add</Button>}
        >
          {sources.length === 0 ? (
            <Text size="2" style={{ color: 'var(--gray-10)' }}>
              No Drive sources yet. Add one, then sign in with Google to connect the account.
            </Text>
          ) : (
            sources.map((s) => (
              <Card key={s.id}>
                <Flex align="center" justify="between" gap="3">
                  <Box>
                    <Text size="2" weight="medium">{s.name}</Text>
                    {s.folderId ? (
                      <Text size="1" style={{ color: 'var(--gray-10)', display: 'block', fontFamily: 'monospace' }}>
                        folder: {s.folderId}
                      </Text>
                    ) : null}
                    <Flex mt="1">
                      <Badge color={s.connected ? 'green' : 'orange'} variant="soft">
                        {s.connected ? 'Connected' : 'Not connected'}
                      </Badge>
                    </Flex>
                  </Box>
                  <Flex gap="2">
                    <Button variant="soft" color="green" onClick={() => void signIn(s)} disabled={srcEditing !== null}>
                      {s.connected ? 'Reconnect' : 'Sign in with Google'}
                    </Button>
                    <Button variant="soft" onClick={() => openEditSource(s)} disabled={srcEditing !== null}>Edit</Button>
                    <Button variant="soft" color="red" onClick={() => void removeSource(s)} disabled={srcBusy}>Delete</Button>
                  </Flex>
                </Flex>
              </Card>
            ))
          )}
        </SettingsSection>
      </Box>

      <Dialog.Root open={srcEditing !== null} onOpenChange={(open) => { if (!open) setSrcEditing(null); }}>
        <Dialog.Content maxWidth="560px">
          <Dialog.Title>{srcEditing === 'new' ? 'New Drive source' : 'Edit Drive source'}</Dialog.Title>
          <Flex direction="column" gap="3" mt="2">
            <Box>
              <Text size="1" as="label">Name</Text>
              <TextField.Root value={srcForm.name} placeholder="e.g. PalmCo (main account)"
                onChange={(e) => setSrcForm((f) => ({ ...f, name: e.target.value }))} />
            </Box>
            <Box>
              <Text size="1" as="label">OAuth Redirect URL — add this to your Google OAuth client</Text>
              <TextField.Root readOnly value={redirectUrl} onFocus={(e) => e.currentTarget.select()} />
            </Box>
            <Box>
              <Text size="1" as="label">Client ID</Text>
              <TextField.Root value={srcForm.clientId} placeholder="….apps.googleusercontent.com"
                onChange={(e) => setSrcForm((f) => ({ ...f, clientId: e.target.value }))} />
            </Box>
            <Box>
              <Text size="1" as="label">Client Secret</Text>
              <TextField.Root
                type="text"
                autoComplete="off"
                value={srcForm.clientSecret ?? ''}
                placeholder={srcEditing !== 'new' ? '•••• (leave blank to keep the stored secret)' : 'GOCSPX-…'}
                onChange={(e) => setSrcForm((f) => ({ ...f, clientSecret: e.target.value }))}
              />
            </Box>
            <Box>
              <Text size="1" as="label">Drive folder ID (optional)</Text>
              <TextField.Root value={srcForm.folderId ?? ''} placeholder="Leave blank to search the whole account"
                onChange={(e) => setSrcForm((f) => ({ ...f, folderId: e.target.value }))} />
            </Box>
            <Text size="1" style={{ color: 'var(--gray-9)' }}>
              Save, then click “Sign in with Google” on the source to connect the account.
            </Text>
            <Flex gap="2" mt="2" justify="end">
              <Button variant="soft" color="gray" onClick={() => setSrcEditing(null)} disabled={srcBusy}>Cancel</Button>
              <Button onClick={() => void saveSource()} disabled={srcBusy}>{srcBusy ? 'Saving…' : 'Save'}</Button>
            </Flex>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </Box>
  );
}
