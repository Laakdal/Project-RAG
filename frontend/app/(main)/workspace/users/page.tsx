'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box,
  Flex,
  Grid,
  Heading,
  Text,
  Table,
  Button,
  Badge,
  TextField,
  Switch,
  Dialog,
  DropdownMenu,
  IconButton,
} from '@radix-ui/themes';
import { useUserStore, selectIsAdmin, selectIsProfileInitialized } from '@/lib/store/user-store';
import { useToastStore } from '@/lib/store/toast-store';
import { validatePassword } from '@/lib/utils/validators';
import { isProcessedError } from '@/lib/api';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import { ConfirmationDialog } from '../components';
import { AdminApi, type AdminUser, type AdminStats } from '@/lib/api/admin';

function errorMessage(err: unknown, fallback: string): string {
  if (isProcessedError(err)) return err.message;
  return fallback;
}

// ── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <Box
      style={{
        padding: 'var(--space-4)',
        borderRadius: 'var(--radius-3)',
        border: '1px solid var(--olive-a4)',
        background: 'var(--olive-a2)',
      }}
    >
      <Text size="6" weight="bold" style={{ color: 'var(--gray-12)', display: 'block' }}>
        {value}
      </Text>
      <Text size="1" style={{ color: 'var(--gray-10)' }}>
        {label}
      </Text>
    </Box>
  );
}

export default function AdminUsersPage() {
  const router = useRouter();
  const isAdmin = useUserStore(selectIsAdmin);
  const initialized = useUserStore(selectIsProfileInitialized);
  const addToast = useToastStore((s) => s.addToast);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [resetFor, setResetFor] = useState<AdminUser | null>(null);
  const [deleteFor, setDeleteFor] = useState<AdminUser | null>(null);
  const [disableFor, setDisableFor] = useState<AdminUser | null>(null);

  const currentUserId = useUserStore((s) => s.profile?.userId ?? null);

  // ── Route guard: only admins ───────────────────────────────────────────────
  useEffect(() => {
    if (initialized && isAdmin === false) {
      router.replace('/workspace/profile');
    }
  }, [initialized, isAdmin, router]);

  // ── Load ────────────────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [u, s] = await Promise.all([AdminApi.listUsers(), AdminApi.stats()]);
      setUsers(u);
      setStats(s);
    } catch (err) {
      addToast({
        variant: 'error',
        title: 'Failed to load users',
        description: errorMessage(err, 'Could not fetch the user list'),
      });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (isAdmin) void refresh();
  }, [isAdmin, refresh]);

  // ── Actions ──────────────────────────────────────────────────────────────────
  const toggleAdmin = useCallback(
    async (u: AdminUser) => {
      try {
        await AdminApi.setAdmin(u.id, !u.isAdmin);
        await refresh();
      } catch (err) {
        addToast({
          variant: 'error',
          title: 'Action failed',
          description: errorMessage(err, 'Could not change the admin flag'),
        });
      }
    },
    [refresh, addToast],
  );

  const confirmDisable = useCallback(async () => {
    if (!disableFor) return;
    const target = disableFor;
    setDisableFor(null);
    try {
      await AdminApi.setDisabled(target.id, target.disabledAt === null);
      await refresh();
    } catch (err) {
      addToast({
        variant: 'error',
        title: 'Action failed',
        description: errorMessage(err, 'Could not update the account'),
      });
    }
  }, [disableFor, refresh, addToast]);

  const confirmDelete = useCallback(async () => {
    if (!deleteFor) return;
    const target = deleteFor;
    setDeleteFor(null);
    try {
      await AdminApi.deleteUser(target.id);
      addToast({ variant: 'success', title: 'User deleted', description: target.email });
      await refresh();
    } catch (err) {
      addToast({
        variant: 'error',
        title: 'Delete failed',
        description: errorMessage(err, 'Could not delete the user'),
      });
    }
  }, [deleteFor, refresh, addToast]);

  if (!initialized || isAdmin !== true) {
    return null;
  }

  return (
    <Box style={{ padding: '64px 100px' }}>
      <Flex justify="between" align="center" style={{ marginBottom: 'var(--space-5)' }}>
        <Box>
          <Heading size="5" weight="medium" style={{ color: 'var(--gray-12)' }}>
            {'Users'}
          </Heading>
          <Text size="2" style={{ color: 'var(--gray-10)', marginTop: 'var(--space-1)', display: 'block' }}>
            {'Manage accounts, admin access, and passwords'}
          </Text>
        </Box>
        <Button onClick={() => setCreateOpen(true)} style={{ cursor: 'pointer' }}>
          <MaterialIcon name="add" size={16} color="currentColor" />
          {'Add user'}
        </Button>
      </Flex>

      {/* ── Stats strip ── */}
      {stats && (
        <Grid columns="4" gap="3" style={{ marginBottom: 'var(--space-6)' }}>
          <StatCard label="Users" value={stats.users} />
          <StatCard label="Admins" value={stats.admins} />
          <StatCard label="Disabled" value={stats.disabledUsers} />
          <StatCard label="Conversations" value={stats.conversations} />
          <StatCard label="Messages" value={stats.messages} />
          <StatCard label="Attachments" value={stats.attachments} />
          <StatCard label="Ingestion failures" value={stats.ingestionFailures} />
        </Grid>
      )}

      {/* ── Users table ── */}
      <Table.Root variant="surface">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>{'Email'}</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>{'Name'}</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>{'Role'}</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>{'Status'}</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {users.map((u) => {
            const isSelf = u.id === currentUserId;
            const disabled = u.disabledAt !== null;
            return (
              <Table.Row key={u.id}>
                <Table.Cell>{u.email}</Table.Cell>
                <Table.Cell>{u.name ?? '—'}</Table.Cell>
                <Table.Cell>
                  {u.isAdmin ? <Badge color="amber">{'Admin'}</Badge> : <Badge color="gray">{'Member'}</Badge>}
                </Table.Cell>
                <Table.Cell>
                  {disabled ? <Badge color="red">{'Disabled'}</Badge> : <Badge color="green">{'Active'}</Badge>}
                </Table.Cell>
                <Table.Cell>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger>
                      <IconButton variant="ghost" color="gray" disabled={isSelf} style={{ cursor: isSelf ? 'not-allowed' : 'pointer' }}>
                        <MaterialIcon name="more_horiz" size={18} color="var(--gray-11)" />
                      </IconButton>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content>
                      <DropdownMenu.Item onSelect={() => void toggleAdmin(u)}>
                        {u.isAdmin ? 'Revoke admin' : 'Make admin'}
                      </DropdownMenu.Item>
                      <DropdownMenu.Item onSelect={() => setDisableFor(u)}>
                        {disabled ? 'Enable account' : 'Disable account'}
                      </DropdownMenu.Item>
                      <DropdownMenu.Item onSelect={() => setResetFor(u)}>
                        {'Reset password'}
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item color="red" onSelect={() => setDeleteFor(u)}>
                        {'Delete'}
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table.Root>

      {loading && (
        <Text size="2" style={{ color: 'var(--gray-10)', marginTop: 'var(--space-4)', display: 'block' }}>
          {'Loading…'}
        </Text>
      )}

      {/* ── Create user dialog ── */}
      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false);
          void refresh();
        }}
      />

      {/* ── Reset password dialog ── */}
      <ResetPasswordDialog
        user={resetFor}
        onClose={() => setResetFor(null)}
        onDone={() => setResetFor(null)}
      />

      {/* ── Disable / enable confirm ── */}
      <ConfirmationDialog
        open={disableFor !== null}
        onOpenChange={(o: boolean) => !o && setDisableFor(null)}
        title={disableFor?.disabledAt ? 'Enable account?' : 'Disable account?'}
        message={
          disableFor?.disabledAt
            ? `${disableFor?.email} will be able to log in again.`
            : `${disableFor?.email} will be blocked from logging in.`
        }
        confirmLabel={disableFor?.disabledAt ? 'Enable' : 'Disable'}
        cancelLabel={'Cancel'}
        confirmVariant={disableFor?.disabledAt ? 'primary' : 'danger'}
        onConfirm={confirmDisable}
      />

      {/* ── Delete confirm ── */}
      <ConfirmationDialog
        open={deleteFor !== null}
        onOpenChange={(o: boolean) => !o && setDeleteFor(null)}
        title={'Delete user?'}
        message={`This permanently deletes ${deleteFor?.email} and all of their conversations, messages, and attachments. This cannot be undone.`}
        confirmLabel={'Delete'}
        cancelLabel={'Cancel'}
        confirmVariant="danger"
        onConfirm={confirmDelete}
      />
    </Box>
  );
}

// ── Create user dialog ─────────────────────────────────────────────────────────
function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const addToast = useToastStore((s) => s.addToast);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [makeAdmin, setMakeAdmin] = useState(false);
  const [busy, setBusy] = useState(false);

  const pwError = password ? validatePassword(password) : null;
  const canSubmit = email.trim() !== '' && password !== '' && pwError === null && !busy;

  const reset = () => {
    setEmail('');
    setName('');
    setPassword('');
    setMakeAdmin(false);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await AdminApi.createUser({
        email: email.trim(),
        name: name.trim() || undefined,
        password,
        isAdmin: makeAdmin,
      });
      addToast({ variant: 'success', title: 'User created', description: email.trim() });
      reset();
      onCreated();
    } catch (err) {
      addToast({
        variant: 'error',
        title: 'Create failed',
        description: errorMessage(err, 'Could not create the user'),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <Dialog.Content style={{ maxWidth: 460 }}>
        <Dialog.Title>{'Add user'}</Dialog.Title>
        <Flex direction="column" gap="3" style={{ marginTop: 'var(--space-3)' }}>
          <label>
            <Text size="2" weight="medium">{'Email'}</Text>
            <TextField.Root value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" />
          </label>
          <label>
            <Text size="2" weight="medium">{'Name (optional)'}</Text>
            <TextField.Root value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
          </label>
          <label>
            <Text size="2" weight="medium">{'Initial password'}</Text>
            <TextField.Root type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Set an initial password" color={pwError ? 'red' : undefined} />
            <Text size="1" style={{ color: pwError ? 'var(--red-a11)' : 'var(--gray-10)' }}>
              {pwError ?? 'At least 8 characters: lowercase, uppercase, number, symbol.'}
            </Text>
          </label>
          <Flex asChild align="center" gap="2">
            <label>
              <Switch checked={makeAdmin} onCheckedChange={setMakeAdmin} />
              <Text size="2">{'Make this user an admin'}</Text>
            </label>
          </Flex>
        </Flex>
        <Flex justify="end" gap="2" style={{ marginTop: 'var(--space-4)' }}>
          <Dialog.Close>
            <Button variant="soft" color="gray">{'Cancel'}</Button>
          </Dialog.Close>
          <Button disabled={!canSubmit} onClick={() => void submit()}>{'Create'}</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

// ── Reset password dialog ──────────────────────────────────────────────────────
function ResetPasswordDialog({
  user,
  onClose,
  onDone,
}: {
  user: AdminUser | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const addToast = useToastStore((s) => s.addToast);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const pwError = password ? validatePassword(password) : null;
  const canSubmit = password !== '' && pwError === null && !busy && user !== null;

  const submit = async () => {
    if (!user || !canSubmit) return;
    setBusy(true);
    try {
      await AdminApi.resetPassword(user.id, password);
      addToast({ variant: 'success', title: 'Password reset', description: user.email });
      setPassword('');
      onDone();
    } catch (err) {
      addToast({
        variant: 'error',
        title: 'Reset failed',
        description: errorMessage(err, 'Could not reset the password'),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={user !== null} onOpenChange={(o) => { if (!o) { setPassword(''); onClose(); } }}>
      <Dialog.Content style={{ maxWidth: 460 }}>
        <Dialog.Title>{'Reset password'}</Dialog.Title>
        <Text size="2" style={{ color: 'var(--gray-10)' }}>{user?.email}</Text>
        <Box style={{ marginTop: 'var(--space-3)' }}>
          <Text size="2" weight="medium">{'New password'}</Text>
          <TextField.Root type="password" value={password} onChange={(e) => setPassword(e.target.value)} color={pwError ? 'red' : undefined} />
          <Text size="1" style={{ color: pwError ? 'var(--red-a11)' : 'var(--gray-10)' }}>
            {pwError ?? 'At least 8 characters: lowercase, uppercase, number, symbol.'}
          </Text>
        </Box>
        <Flex justify="end" gap="2" style={{ marginTop: 'var(--space-4)' }}>
          <Dialog.Close>
            <Button variant="soft" color="gray">{'Cancel'}</Button>
          </Dialog.Close>
          <Button disabled={!canSubmit} onClick={() => void submit()}>{'Reset'}</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
