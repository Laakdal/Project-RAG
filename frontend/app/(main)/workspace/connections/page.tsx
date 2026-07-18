'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Box, Button, Card, Flex, Heading, Select, Text, TextField } from '@radix-ui/themes';
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

export default function ConnectionsPage() {
  const router = useRouter();
  const isAdmin = useUserStore(selectIsAdmin);
  const initialized = useUserStore(selectIsProfileInitialized);
  const addToast = useToastStore((s) => s.addToast);

  const [data, setData] = useState<ConnectionsData | null>(null);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<ConnectionInput>(EMPTY);
  const [busy, setBusy] = useState(false);

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

  const openNew = () => {
    const base = data?.platforms.find((p) => p.key === 'openrouter')?.baseUrl ?? '';
    setForm({ ...EMPTY, baseUrl: base });
    setEditingId('new');
  };
  const openEdit = (c: ApiConnection) => {
    setForm({ name: c.name, platform: c.platform, baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model });
    setEditingId(c.id);
  };
  const onPlatform = (key: string) => {
    const preset = data?.platforms.find((p) => p.key === key);
    setForm((f) => ({ ...f, platform: key, baseUrl: preset && preset.baseUrl ? preset.baseUrl : f.baseUrl }));
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
    <Box style={{ padding: 'var(--space-5)', maxWidth: 820 }}>
      <Heading size="6" mb="2">API Connections</Heading>
      <Text size="2" style={{ color: 'var(--gray-10)', display: 'block', marginBottom: 'var(--space-5)' }}>
        Reusable OpenAI-compatible provider endpoints, and which one each part of the RAG pipeline
        uses. Changes take effect immediately.
      </Text>

      {/* Role assignment */}
      <Heading size="3" mb="3">Model roles</Heading>
      <Flex direction="column" gap="3" mb="6">
        {data.roleDefs.map((rd) => (
          <Flex key={rd.role} align="center" justify="between" gap="3">
            <Box>
              <Text size="2" weight="medium">{rd.label}</Text>
              {rd.note ? (
                <Text size="1" style={{ color: 'var(--gray-9)', display: 'block' }}>{rd.note}</Text>
              ) : null}
            </Box>
            <Select.Root value={data.roles[rd.role] ?? undefined} onValueChange={(v) => void assign(rd.role, v)}>
              <Select.Trigger placeholder="Choose a connection" style={{ minWidth: 260 }} />
              <Select.Content>
                {data.connections.map((c) => (
                  <Select.Item key={c.id} value={c.id}>{c.name} · {c.model}</Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Flex>
        ))}
      </Flex>

      {/* Connections list */}
      <Flex align="center" justify="between" mb="3">
        <Heading size="3">Connections</Heading>
        <Button onClick={openNew} disabled={editingId !== null}>+ Create</Button>
      </Flex>

      <Flex direction="column" gap="3">
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
      </Flex>

      {/* Create / edit form */}
      {editingId !== null ? (
        <Card mt="4">
          <Heading size="3" mb="3">{editingId === 'new' ? 'New connection' : 'Edit connection'}</Heading>
          <Flex direction="column" gap="3">
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
                onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} />
            </Box>
            <Box>
              <Text size="1" as="label">API key</Text>
              <TextField.Root type="password" value={form.apiKey} placeholder="sk-or-v1-..."
                onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))} />
            </Box>
            <Box>
              <Text size="1" as="label">Model</Text>
              <TextField.Root value={form.model} placeholder="z-ai/glm-4.6"
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} />
            </Box>
            <Flex gap="2">
              <Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
              <Button variant="soft" color="gray" onClick={() => setEditingId(null)} disabled={busy}>Cancel</Button>
            </Flex>
          </Flex>
        </Card>
      ) : null}
    </Box>
  );
}
