'use client';

import React, { startTransition, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Callout,
  Dialog,
  Flex,
  IconButton,
  Separator,
  Spinner,
  Text,
} from '@radix-ui/themes';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import { LoadingButton } from '@/app/components/ui/loading-button';
import { SchemaFormField } from '@/app/(main)/workspace/connectors/components/schema-form-field';
import type { AuthSchemaField } from '@/app/(main)/workspace/connectors/types';
import { isNoneAuthType, isOAuthType, isCredentialAuthType } from '@/app/(main)/workspace/connectors/utils/auth-helpers';
import { formatAuthTypeName } from '@/app/(main)/workspace/connectors/components/authenticate-tab/helpers';
import { ToolsetsApi, type BuilderSidebarToolset } from '@/app/(main)/toolsets/api';
import {
  apiErrorDetail,
  authFieldsForType,
  getToolsetAuthConfigFromSchema,
  isOrgOAuthAppCredentialFieldName,
} from './toolset-agent-auth-helpers';
import {
  toolsetDialogBackdropStyle,
  toolsetDialogFooterPrimaryClusterStyle,
  toolsetDialogFooterToolbarStyle,
  toolsetDialogPanelStyle,
  toolsetDialogPrimaryActionsStyle,
} from './toolset-config-dialog-styles';
import { useToolsetOauthPopupFlow } from '../hooks/use-toolset-oauth-popup-flow';

export interface AgentToolsetCredentialsDialogProps {
  toolset: BuilderSidebarToolset;
  instanceId: string;
  agentKey: string;
  onClose: () => void;
  /** Refresh toolsets / follow-up work; must not block closing the dialog. */
  onSuccess: () => void | Promise<void>;
  /** Optional banner / toast line (e.g. OAuth success or cancelled). */
  onNotify?: (message: string) => void;
}

export function AgentToolsetCredentialsDialog({
  toolset,
  instanceId,
  agentKey,
  onClose,
  onSuccess,
  onNotify,
}: AgentToolsetCredentialsDialogProps) {
  const authType = (toolset.authType || 'NONE').toUpperCase();
  const productName =
    toolset.displayName || toolset.name || "Toolset";
  const instanceLabel = (toolset.instanceName ?? '').trim();
  const displayName = instanceLabel || productName;
  const subtitle =
    instanceLabel && productName && instanceLabel !== productName ? productName : null;
  const iconPath = toolset.iconPath || '';
  const tools = toolset.tools || [];
  const [iconBroken, setIconBroken] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(false);

  const [schemaRaw, setSchemaRaw] = useState<unknown>(null);
  const [schemaLoading, setSchemaLoading] = useState(true);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saveAttempted, setSaveAttempted] = useState(false);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(toolset.isAuthenticated ?? false);

  useEffect(() => {
    setIsAuthenticated(toolset.isAuthenticated ?? false);
  }, [toolset.isAuthenticated]);

  useEffect(() => {
    setIconBroken(false);
  }, [iconPath]);

  const authConfig = useMemo(() => getToolsetAuthConfigFromSchema(schemaRaw), [schemaRaw]);

  const manageFields: AuthSchemaField[] = useMemo(
    () => authFieldsForType(authConfig, authType),
    [authConfig, authType]
  );

  /** Never collect org OAuth app id/secret in agent (or user) credential flows. */
  const userCredentialFields = useMemo(
    () => manageFields.filter((f) => !isOrgOAuthAppCredentialFieldName(f.name)),
    [manageFields]
  );

  useEffect(() => {
    const toolsetType = toolset.toolsetType?.trim();
    if (!toolsetType) {
      setSchemaLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setSchemaLoading(true);
        const s = await ToolsetsApi.getToolsetRegistrySchema(toolsetType);
        if (!cancelled) setSchemaRaw(s);
      } catch {
        if (!cancelled) setSchemaRaw(null);
      } finally {
        if (!cancelled) setSchemaLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toolset.toolsetType]);

  useEffect(() => {
    if (!toolset.auth || authType === 'OAUTH' || isNoneAuthType(authType)) return;
    const hydrated: Record<string, unknown> = {};
    userCredentialFields.forEach((field) => {
      const v = toolset.auth?.[field.name];
      if (v !== undefined && v !== null) {
        hydrated[field.name] = Array.isArray(v) ? v.join(',') : v;
      }
    });
    if (Object.keys(hydrated).length > 0) {
      setFormData((prev) => ({ ...hydrated, ...prev }));
    }
  }, [toolset.auth, authType, userCredentialFields]);

  const setField = useCallback((name: string, value: unknown) => {
    setFormData((p) => ({ ...p, [name]: value }));
    setFormErrors((p) => {
      const n = { ...p };
      delete n[name];
      return n;
    });
  }, []);

  const validateForm = useCallback(() => {
    const errors: Record<string, string> = {};
    userCredentialFields.forEach((field) => {
      const value = formData[field.name];
      if (field.required && (value === undefined || value === null || String(value).trim() === '')) {
        errors[field.name] = `${field.displayName} is required`;
      }
    });
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }, [userCredentialFields, formData]);

  const verifyOAuthComplete = useCallback(async (): Promise<boolean> => {
    try {
      const row = await ToolsetsApi.findAgentToolsetByInstanceId(agentKey, instanceId);
      return Boolean(row?.isAuthenticated);
    } catch {
      return false;
    }
  }, [agentKey, instanceId]);

  const onOAuthVerified = useCallback(() => {
    setIsAuthenticated(true);
    startTransition(() => {
      onClose();
    });
    void Promise.resolve(onSuccess()).catch(() => {
      /* extra refresh failed; parent onClose already triggers a refresh */
    });
  }, [onClose, onSuccess]);

  const onOAuthIncomplete = useCallback(() => {
    setError("Sign-in did not finish. The window may have been closed before completion — try again when you are ready.");
  }, []);

  const { authenticating, authenticatingRef, beginOAuth, cancelForUserDismissal } = useToolsetOauthPopupFlow({
    verifyAuthenticated: verifyOAuthComplete,
    onVerified: onOAuthVerified,
    onNotify,
    onIncomplete: onOAuthIncomplete,
    onOAuthPopupError: (msg) => setError(msg),
  });

  const dismissLocked = saving || deleting;

  const requestDismiss = useCallback(() => {
    if (dismissLocked) return;
    if (authenticatingRef.current) {
      cancelForUserDismissal();
    }
    onClose();
  }, [authenticatingRef, cancelForUserDismissal, dismissLocked, onClose]);

  const handleSaveCredentials = async () => {
    setSaveAttempted(true);
    if (!validateForm()) {
      setError("Please fill in all required fields.");
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const safeAuthPayload = Object.fromEntries(
        Object.entries(formData).filter(([k]) => !isOrgOAuthAppCredentialFieldName(k))
      );
      if (isAuthenticated) {
        await ToolsetsApi.updateAgentToolsetCredentials(agentKey, instanceId, safeAuthPayload);
      } else {
        await ToolsetsApi.authenticateAgentToolset(agentKey, instanceId, safeAuthPayload);
      }
      setIsAuthenticated(true);
      onNotify?.("Toolset authentication updated.");
      onClose();
    } catch (e) {
      setError(apiErrorDetail(e));
    } finally {
      setSaving(false);
    }
  };

  const handleOAuthAuthenticate = async () => {
    setError(null);
    await beginOAuth(
      async () => {
        const result = await ToolsetsApi.getAgentToolsetOAuthUrl(
          agentKey,
          instanceId,
          typeof window !== 'undefined' ? window.location.origin : undefined
        );
        if (!result.success || !result.authorizationUrl) {
          throw new Error("Failed to get authorization URL");
        }
        return {
          authorizationUrl: result.authorizationUrl,
          windowName: 'oauth_agent_toolset',
        };
      },
      {
        onTimeout: () => setError("Authentication timed out. Please try again."),
        onOpenError: (e) => setError(apiErrorDetail(e)),
      }
    );
  };

  const handleRemoveConfirmed = async () => {
    setRemoveConfirmOpen(false);
    try {
      setDeleting(true);
      setError(null);
      if (isOAuthType(authType)) {
        await ToolsetsApi.reauthenticateAgentToolset(agentKey, instanceId);
      } else {
        await ToolsetsApi.removeAgentToolsetCredentials(agentKey, instanceId);
      }
      setIsAuthenticated(false);
      onNotify?.("Toolset authentication updated.");
      onClose();
    } catch (e) {
      setError(apiErrorDetail(e));
    } finally {
      setDeleting(false);
    }
  };

  const busy = saving || authenticating || deleting;
  const oauthDisconnectFlow = isOAuthType(authType);

  const showFooterPrimaryCluster =
    !schemaLoading &&
    (isOAuthType(authType) || (isCredentialAuthType(authType) && userCredentialFields.length > 0));

  const handleMainOpenChange = (open: boolean) => {
    if (!open && !dismissLocked) requestDismiss();
  };

  return (
    <>
      <Dialog.Root open onOpenChange={handleMainOpenChange}>
        <Box
          style={{
            ...toolsetDialogBackdropStyle,
            cursor: dismissLocked ? 'not-allowed' : 'pointer',
          }}
          onClick={() => requestDismiss()}
        />
        <Dialog.Content style={{ ...toolsetDialogPanelStyle, maxHeight: 'min(90vh, 44rem)', overflow: 'auto' }}>
          <Box style={{ width: '100%', minWidth: 0 }}>
          <Flex align="start" justify="between" gap="3" mb="3">
            <Flex align="center" gap="3" style={{ minWidth: 0, flex: 1 }}>
              <Box
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 'var(--radius-3)',
                  border: '1px solid var(--gray-a4)',
                  background: 'var(--gray-2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {iconPath && !iconBroken ? (
                  <img
                    src={iconPath}
                    alt=""
                    width={32}
                    height={32}
                    style={{ objectFit: 'contain' }}
                    onError={() => setIconBroken(true)}
                  />
                ) : (
                  <MaterialIcon name="extension" size={28} color="var(--slate-11)" />
                )}
              </Box>
              <Box style={{ minWidth: 0 }}>
                <Dialog.Title style={{ marginBottom: 4 }}>{"Agent toolset credentials"}</Dialog.Title>
                <Text size="3" weight="bold" style={{ color: 'var(--slate-12)', display: 'block' }}>
                  {displayName}
                </Text>
                {subtitle ? (
                  <Text size="2" style={{ color: 'var(--slate-11)', display: 'block', marginTop: 2 }}>
                    {subtitle}
                  </Text>
                ) : null}
                <Flex gap="2" wrap="wrap" mt="2">
                  <Badge size="1" color="gray">
                    {formatAuthTypeName(authType)}
                  </Badge>
                  <Badge size="1" color="gray" variant="surface">
                    {"Service agent"}
                  </Badge>
                </Flex>
              </Box>
            </Flex>
            <IconButton variant="ghost" color="gray" onClick={() => requestDismiss()} disabled={dismissLocked} aria-label={"Close"}>
              <MaterialIcon name="close" size={20} />
            </IconButton>
          </Flex>

          <Dialog.Description size="2" mb="3" style={{ color: 'var(--slate-11)' }}>
            {"Stored for this agent only. Runs use these credentials for everyone."}
          </Dialog.Description>

          <Callout.Root color="jade" variant="surface" size="1" mb="3">
            <Callout.Icon>
              <MaterialIcon name="smart_toy" size={18} />
            </Callout.Icon>
            <Callout.Text size="1" style={{ color: 'var(--slate-11)' }}>
              {"These credentials are stored for the agent, not for individual users. Anyone who uses this agent shares them when this toolset runs."}
            </Callout.Text>
          </Callout.Root>

          {schemaLoading ? (
            <Flex align="center" gap="3" py="4" justify="center">
              <Spinner size="2" />
              <Text size="2" color="gray">
                {"Loading schema…"}
              </Text>
            </Flex>
          ) : null}

          {!schemaLoading && toolset.description ? (
            <Text size="2" mb="3" style={{ color: 'var(--slate-11)', lineHeight: 1.55 }}>
              {toolset.description}
            </Text>
          ) : null}

          {!schemaLoading && error ? (
            <Callout.Root color="red" variant="surface" size="1" mb="3">
              <Callout.Text style={{ flex: 1, minWidth: 0 }}>{error}</Callout.Text>
            </Callout.Root>
          ) : null}

          {!schemaLoading && isNoneAuthType(authType) ? (
            <Text size="2">{"No credentials are required for this toolset."}</Text>
          ) : null}

          {!schemaLoading && isOAuthType(authType) ? (
            <Flex direction="column" gap="3" width="100%">
              <Callout.Root color="blue" variant="surface" size="1">
                <Callout.Icon>
                  <MaterialIcon name={isAuthenticated ? 'verified_user' : 'link'} size={18} />
                </Callout.Icon>
                <Callout.Text size="1" style={{ color: 'var(--slate-11)' }}>
                  {isAuthenticated ? "OAuth is connected for this agent. Use Reconnect to sign in again, or Disconnect to end this session for this agent." : "Sign in with OAuth in a popup. After you finish, this dialog will detect completion."}
                </Callout.Text>
              </Callout.Root>
            </Flex>
          ) : null}

          {!schemaLoading && isCredentialAuthType(authType) && userCredentialFields.length > 0 ? (
            <Flex direction="column" gap="4">
              <Separator size="4" />
              <Text size="2" weight="medium" style={{ color: 'var(--slate-12)' }}>
                {"Agent credentials"}
              </Text>
              {userCredentialFields.map((field) => (
                <SchemaFormField
                  key={field.name}
                  field={field}
                  value={formData[field.name]}
                  onChange={setField}
                  error={saveAttempted ? formErrors[field.name] : undefined}
                  disabled={busy}
                />
              ))}
              {isAuthenticated ? (
                <Callout.Root color="green" variant="surface" size="1">
                  <Callout.Text size="1">{"The agent is authenticated. Enter new values and save to update stored credentials."}</Callout.Text>
                </Callout.Root>
              ) : null}
            </Flex>
          ) : null}

          {!schemaLoading && isCredentialAuthType(authType) && userCredentialFields.length === 0 ? (
            <Callout.Root color="amber" variant="surface" size="1" mt="2">
              <Callout.Text size="1">{"No credential fields were returned for this auth type. If this persists, check the toolset registry schema."}</Callout.Text>
            </Callout.Root>
          ) : null}

          {!schemaLoading && tools.length > 0 ? (
            <Box mt="4">
              <Text size="2" weight="medium" mb="2" style={{ color: 'var(--slate-12)', display: 'block' }}>
                {`Available tools (${tools.length})`}
              </Text>
              <Flex gap="2" wrap="wrap" align="center">
                {(toolsExpanded ? tools : tools.slice(0, 12)).map((tool) => (
                  <Badge key={tool.fullName || tool.name} size="1" color="gray" variant="surface">
                    {tool.name}
                  </Badge>
                ))}
                {tools.length > 12 ? (
                  <Button type="button" size="1" variant="soft" color="gray" onClick={() => setToolsExpanded((v) => !v)}>
                    {toolsExpanded ? "Show fewer" : `+${tools.length - 12} more`}
                  </Button>
                ) : null}
              </Flex>
            </Box>
          ) : null}

          <Separator size="4" my="4" />

          {showFooterPrimaryCluster ? (
            <Box style={toolsetDialogFooterToolbarStyle}>
              {isOAuthType(authType) ? (
                <Flex
                  wrap="wrap"
                  gap="2"
                  style={{
                    ...toolsetDialogPrimaryActionsStyle,
                    ...toolsetDialogFooterPrimaryClusterStyle,
                  }}
                >
                  <Button size="2" variant="soft" color="green" onClick={() => void handleOAuthAuthenticate()} disabled={busy}>
                    {authenticating
                      ? "Waiting for OAuth…"
                      : isAuthenticated
                        ? "Reconnect"
                        : "Authenticate with OAuth"}
                  </Button>
                  {isAuthenticated ? (
                    <Button size="2" variant="soft" color="red" onClick={() => setRemoveConfirmOpen(true)} disabled={busy}>
                      {"Disconnect"}
                    </Button>
                  ) : null}
                </Flex>
              ) : null}
              {isCredentialAuthType(authType) && userCredentialFields.length > 0 ? (
                <Flex
                  wrap="wrap"
                  gap="2"
                  style={{
                    ...toolsetDialogPrimaryActionsStyle,
                    ...toolsetDialogFooterPrimaryClusterStyle,
                  }}
                >
                  <LoadingButton
                    size="2"
                    variant="soft"
                    color="green"
                    onClick={() => void handleSaveCredentials()}
                    disabled={busy && !saving}
                    loading={saving}
                    loadingLabel={"Saving…"}
                  >
                    {isAuthenticated
                      ? "Save changes"
                      : "Save credentials"}
                  </LoadingButton>
                  {isAuthenticated ? (
                    <Button size="2" variant="soft" color="red" onClick={() => setRemoveConfirmOpen(true)} disabled={busy}>
                      {"Remove credentials"}
                    </Button>
                  ) : null}
                </Flex>
              ) : null}
              <Box style={{ flexShrink: 0, marginInlineStart: 'auto' }}>
                <Button size="2" variant="soft" color="gray" onClick={() => requestDismiss()} disabled={dismissLocked}>
                  {isAuthenticated ? "Close" : "Cancel"}
                </Button>
              </Box>
            </Box>
          ) : (
            <Flex justify="end" width="100%">
              <Button size="2" variant="soft" color="gray" onClick={() => requestDismiss()} disabled={dismissLocked}>
                {isAuthenticated ? "Close" : "Cancel"}
              </Button>
            </Flex>
          )}
          </Box>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={removeConfirmOpen} onOpenChange={setRemoveConfirmOpen}>
        <Box
          style={{
            ...toolsetDialogBackdropStyle,
            zIndex: 1001,
            cursor: deleting ? 'not-allowed' : 'pointer',
          }}
          onClick={() => !deleting && setRemoveConfirmOpen(false)}
        />
        <Dialog.Content
          style={{
            ...toolsetDialogPanelStyle,
            maxWidth: 'min(28rem, calc(100vw - 2rem))',
            zIndex: 1002,
          }}
        >
          <Dialog.Title>
            {oauthDisconnectFlow
              ? `Disconnect ${displayName}?`
              : "Remove credentials?"}
          </Dialog.Title>
          <Text size="2" mb="3" style={{ color: 'var(--slate-11)' }}>
            {oauthDisconnectFlow
              ? `This ends the OAuth session for ${displayName} on this agent. The toolset remains on the agent but is not authenticated until you sign in again.`
              : `This removes stored credentials for ${displayName} on this agent until you configure them again.`}
          </Text>
          <Flex gap="2" justify="end">
            <Dialog.Close>
              <Button variant="soft" color="gray" disabled={deleting}>
                {"Cancel"}
              </Button>
            </Dialog.Close>
            <Button color="red" onClick={() => void handleRemoveConfirmed()} disabled={deleting}>
              {deleting
                ? oauthDisconnectFlow
                  ? "Disconnecting…"
                  : "Removing…"
                : oauthDisconnectFlow
                  ? "Disconnect"
                  : "Remove"}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
