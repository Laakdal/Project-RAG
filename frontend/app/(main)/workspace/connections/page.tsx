'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Box, Button, Card, Dialog, Flex, Heading, IconButton, Select, Spinner, Text, TextField } from '@radix-ui/themes';
import { SettingsSection, SettingsRow } from '../components';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import { useUserStore, selectIsAdmin, selectIsProfileInitialized } from '@/lib/store/user-store';
import { useToastStore } from '@/lib/store/toast-store';
import { isProcessedError } from '@/lib/api';
import {
  ConnectionsApi,
  type ConnectionsData,
  type ApiConnection,
  type ConnectionInput,
} from '@/lib/api/connections';

function errorMessage(err: unknown, fallback: string): string {
  if (isProcessedError(err)) return err.message;
  return fallback;
}

const EMPTY: ConnectionInput = { name: '', platform: 'openrouter', baseUrl: '', apiKey: '', model: '' };

// A text input (so the browser never offers to save it as a password) that is
// visually masked via -webkit-text-security unless revealed by the eye toggle.
function apiKeyStyle(reveal: boolean): CSSProperties {
  const s: Record<string, string | number> = {
    width: '100%',
    height: 32,
    padding: '0 36px 0 10px',
    borderRadius: 'var(--radius-2)',
    border: '1px solid var(--gray-a7)',
    background: 'var(--color-surface)',
    color: 'var(--gray-12)',
    // Match the radix TextField inputs (font family + size + spacing).
    fontFamily: 'var(--default-font-family)',
    fontSize: 'var(--font-size-2)',
    letterSpacing: 'var(--letter-spacing-2)',
    boxSizing: 'border-box',
    outline: 'none',
    WebkitTextSecurity: reveal ? 'none' : 'disc',
  };
  return s as unknown as CSSProperties;
}

export default function ConnectionsPage() {
  const router = useRouter();
  const isAdmin = useUserStore(selectIsAdmin);
  const initialized = useUserStore(selectIsProfileInitialized);
  const addToast = useToastStore((s) => s.addToast);

  const [data, setData] = useState<ConnectionsData | null>(null);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<ConnectionInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  // True once a model list was fetched successfully — flips the retry button to
  // a checkmark. Reset whenever the base URL / key / platform change (below), so
  // the checkmark never lingers over credentials it wasn't loaded with.
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (initialized && isAdmin === false) router.replace('/chat/');
  }, [initialized, isAdmin, router]);

  const refresh = useCallback(async () => {
    try {
      setData(await ConnectionsApi.get());
    } catch (err) {
      addToast({ variant: 'error', title: 'Failed to load connections', description: errorMessage(err, '') });
    }
  }, [addToast]);

  useEffect(() => {
    if (isAdmin) void refresh();
  }, [isAdmin, refresh]);

  // Which roles point at each connection (for the badges on each card).
  const rolesByConn = useMemo(() => {
    const map: Record<string, string[]> = {};
    if (!data) return map;
    for (const rd of data.roleDefs) {
      const id = data.roles[rd.role];
      if (id) (map[id] ??= []).push(rd.label);
    }
    return map;
  }, [data]);

  // Fetch the models the provider offers, to populate the Model dropdown.
  const loadModels = useCallback(
    async (baseUrl: string, apiKey: string) => {
      if (!baseUrl || !apiKey) {
        addToast({ variant: 'warning', title: 'Enter the base URL and API key first' });
        return;
      }
      setModelsLoading(true);
      setModelsLoaded(false);
      try {
        const models = await ConnectionsApi.models(baseUrl, apiKey);
        setModelOptions(models);
        if (models.length === 0) addToast({ variant: 'warning', title: 'No models returned by this API' });
        else setModelsLoaded(true); // success → button becomes a checkmark
      } catch (err) {
        addToast({ variant: 'error', title: 'Failed to fetch models', description: errorMessage(err, '') });
      } finally {
        setModelsLoading(false);
      }
    },
    [addToast],
  );

  const openNew = () => {
    const base = data?.platforms.find((p) => p.key === 'openrouter')?.baseUrl ?? '';
    setForm({ ...EMPTY, baseUrl: base });
    setModelOptions([]);
    setModelsLoaded(false);
    setShowKey(false);
    setEditingId('new');
  };
  const openEdit = (c: ApiConnection) => {
    setForm({ name: c.name, platform: c.platform, baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model });
    setModelOptions([]);
    setShowKey(false);
    setEditingId(c.id);
    void loadModels(c.baseUrl, c.apiKey); // pre-populate the dropdown for edits
  };
  const onPlatform = (key: string) => {
    const preset = data?.platforms.find((p) => p.key === key);
    setForm((f) => ({ ...f, platform: key, baseUrl: preset && preset.baseUrl ? preset.baseUrl : f.baseUrl }));
    setModelsLoaded(false);
  };

  const save = useCallback(async () => {
    if (!form.name || !form.baseUrl || !form.apiKey || !form.model) {
      addToast({ variant: 'warning', title: 'Missing fields', description: 'Name, base URL, API key and model are required.' });
      return;
    }
    setBusy(true);
    try {
      const next = editingId === 'new' ? await ConnectionsApi.create(form) : await ConnectionsApi.update(editingId as string, form);
      setData(next);
      setEditingId(null);
      addToast({ variant: 'success', title: 'Connection saved' });
    } catch (err) {
      addToast({ variant: 'error', title: 'Save failed', description: errorMessage(err, 'Please try again.') });
    } finally {
      setBusy(false);
    }
  }, [form, editingId, addToast]);

  const remove = useCallback(
    async (c: ApiConnection) => {
      setBusy(true);
      try {
        setData(await ConnectionsApi.remove(c.id));
        addToast({ variant: 'success', title: 'Connection deleted', description: c.name });
      } catch (err) {
        addToast({ variant: 'error', title: 'Delete failed', description: errorMessage(err, '') });
      } finally {
        setBusy(false);
      }
    },
    [addToast],
  );

  const assign = useCallback(
    async (role: string, connectionId: string) => {
      try {
        setData(await ConnectionsApi.setRole(role, connectionId));
      } catch (err) {
        addToast({ variant: 'error', title: 'Assignment failed', description: errorMessage(err, '') });
      }
    },
    [addToast],
  );

  if (!isAdmin || !data) return null;

  return (
    <Box style={{ padding: 'var(--space-5)', maxWidth: 820, margin: '0 auto' }}>
      <Heading size="6" mb="2">API Connections</Heading>
      <Text size="2" style={{ color: 'var(--gray-10)', display: 'block', marginBottom: 'var(--space-5)' }}>
        Reusable OpenAI-compatible provider endpoints, and which one each part of the RAG pipeline
        uses. Changes take effect immediately.
      </Text>

      <Flex direction="column" gap="4">
        {/* Role assignment */}
        <SettingsSection title="Model roles" description="Which connection each part of the pipeline uses.">
          {data.roleDefs.map((rd) => (
            <SettingsRow key={rd.role} label={rd.label} description={rd.note}>
              <Select.Root value={data.roles[rd.role] ?? undefined} onValueChange={(v) => void assign(rd.role, v)}>
                <Select.Trigger placeholder="Choose a connection" style={{ width: '100%' }} />
                <Select.Content>
                  {data.connections.map((c) => (
                    <Select.Item key={c.id} value={c.id}>{c.name}</Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </SettingsRow>
          ))}
        </SettingsSection>

        {/* Connections list */}
        <SettingsSection
          title="Connections"
          rightAction={<Button onClick={openNew} disabled={editingId !== null}>+ Create</Button>}
        >
          {data.connections.map((c) => (
            <Card key={c.id}>
              <Flex align="center" justify="between" gap="3">
                <Box>
                  <Text size="2" weight="medium">{c.name}</Text>
                  <Text size="1" style={{ color: 'var(--gray-10)', display: 'block', fontFamily: 'monospace' }}>
                    {c.platform}: {c.model}
                  </Text>
                  <Flex gap="1" mt="1" wrap="wrap">
                    {(rolesByConn[c.id] ?? []).map((label) => (
                      <Badge key={label} color="green" variant="soft">{label}</Badge>
                    ))}
                  </Flex>
                </Box>
                <Flex gap="2">
                  <Button variant="soft" onClick={() => openEdit(c)} disabled={editingId !== null}>Edit</Button>
                  <Button variant="soft" color="red" onClick={() => void remove(c)} disabled={busy}>Delete</Button>
                </Flex>
              </Flex>
            </Card>
          ))}
        </SettingsSection>

      </Flex>

      {/* Create / edit form (modal) */}
      <Dialog.Root open={editingId !== null} onOpenChange={(open) => { if (!open) setEditingId(null); }}>
        <Dialog.Content maxWidth="480px">
          <Dialog.Title>{editingId === 'new' ? 'New connection' : 'Edit connection'}</Dialog.Title>
          <Flex direction="column" gap="3" mt="2">
            <Box>
              <Text size="1" as="label">Name</Text>
              <TextField.Root value={form.name} placeholder="e.g. OpenRouter API GLM 4.6"
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </Box>
            <Box>
              <Text size="1" as="label">Model platform</Text>
              <Select.Root value={form.platform} onValueChange={onPlatform}>
                <Select.Trigger style={{ width: '100%' }} />
                <Select.Content>
                  {data.platforms.map((p) => (
                    <Select.Item key={p.key} value={p.key}>{p.label}</Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Box>
            <Box>
              <Text size="1" as="label">API base URL</Text>
              <TextField.Root value={form.baseUrl} placeholder="https://openrouter.ai/api/v1"
                onChange={(e) => { setForm((f) => ({ ...f, baseUrl: e.target.value })); setModelsLoaded(false); }} />
            </Box>
            <Box>
              <Text size="1" as="label">API key</Text>
              {/* A text input (never type=password) so the browser's "save
                  password?" prompt never fires; masked via -webkit-text-security
                  and revealed with the eye toggle. */}
              <Box style={{ position: 'relative' }}>
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  data-lpignore="true"
                  data-1p-ignore=""
                  value={form.apiKey}
                  placeholder="sk-or-v1-..."
                  onChange={(e) => { setForm((f) => ({ ...f, apiKey: e.target.value })); setModelsLoaded(false); }}
                  style={apiKeyStyle(showKey)}
                />
                <button
                  type="button"
                  aria-label={showKey ? 'Hide API key' : 'Show API key'}
                  onClick={() => setShowKey((v) => !v)}
                  style={{
                    position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--gray-10)', display: 'flex', padding: 2,
                  }}
                >
                  <MaterialIcon name={showKey ? 'visibility_off' : 'visibility'} size={18} />
                </button>
              </Box>
            </Box>
            <Box>
              <Text size="1" as="label">Model</Text>
              <Flex gap="2" align="center">
                <Box style={{ flex: 1 }}>
                  <Select.Root value={form.model || undefined} onValueChange={(v) => setForm((f) => ({ ...f, model: v }))}>
                    <Select.Trigger placeholder="Load models, then pick one" style={{ width: '100%' }} />
                    <Select.Content>
                      {[...new Set([...modelOptions, form.model].filter(Boolean))].map((m) => (
                        <Select.Item key={m} value={m}>{m}</Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </Box>
                {/* Retry icon that fetches the model list; turns into a check
                    once models load, and a spinner while loading. */}
                <IconButton
                  type="button"
                  variant="soft"
                  color={modelsLoaded ? 'green' : undefined}
                  onClick={() => void loadModels(form.baseUrl, form.apiKey)}
                  disabled={modelsLoading}
                  aria-label={modelsLoaded ? 'Models loaded — reload' : 'Load models'}
                  title={modelsLoaded ? 'Models loaded — click to reload' : 'Load models'}
                  style={{ cursor: modelsLoading ? 'default' : 'pointer' }}
                >
                  {modelsLoading ? (
                    <Spinner />
                  ) : (
                    <MaterialIcon name={modelsLoaded ? 'check' : 'refresh'} size={18} color="currentColor" />
                  )}
                </IconButton>
              </Flex>
            </Box>
            <Flex gap="2" mt="2" justify="end">
              <Button variant="soft" color="gray" onClick={() => setEditingId(null)} disabled={busy}>Cancel</Button>
              <Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
            </Flex>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </Box>
  );
}
