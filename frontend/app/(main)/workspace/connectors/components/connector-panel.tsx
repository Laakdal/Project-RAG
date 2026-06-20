'use client';

import { useRouter } from 'next/navigation';
import { Flex, Tabs, Box, Button, Text } from '@radix-ui/themes';
import React, { useEffect, useCallback, useRef, useState } from 'react';
import { ConnectorIcon, MaterialIcon } from '@/app/components/ui';
import { LottieLoader } from '@/app/components/ui/lottie-loader';
import {
  WorkspaceRightPanel,
  useWorkspaceRightPanelBodyRefresh,
  useWorkspaceDrawerNestedModalHost,
} from '@/app/(main)/workspace/components/workspace-right-panel';
import { ConfirmationDialog } from '@/app/(main)/workspace/components/confirmation-dialog';
import { DisableFirstDialog } from './disable-first-dialog';
import { AuthenticateTab } from './authenticate-tab';
import { AuthorizeTab } from './authorize-tab';
import { ConfigureTab } from './configure-tab';
import { SelectRecordsPage } from './select-records-page';
import { useUserStore, selectIsAdmin, selectIsProfileInitialized } from '@/lib/store/user-store';
import { useToastStore } from '@/lib/store/toast-store';
import { useConnectorsStore } from '../store';
import { ConnectorsApi } from '../api';
import {
  isNoneAuthType,
  isOAuthType,
  isConnectorConfigAuthenticated,
  isConnectorInstanceAuthenticatedForUi,
  resolveOAuthFieldVisibility,
} from '../utils/auth-helpers';
import { trimAuthPayloadForApi, trimConnectorConfig } from '../utils/trim-config';
import { collectSyncCustomFieldErrors } from '../utils/sync-custom-fields-validation';
import {
  visibleAuthSchemaFields,
  collectAuthFieldErrors,
} from './authenticate-tab/auth-step-validation';
import { useConnectorOAuthPopup } from './authenticate-tab/use-connector-oauth-popup';
import {
  hasAnySyncFiltersSelected,
  isManualIndexingEnabled,
} from '../utils/sync-filter-save-guards';
import type { PanelTab } from '../types';
import { getConnectorDocumentationUrl } from '../utils/connector-metadata';

/** Non-admin OAuth instances must pick an OAuth app before save. */
function oauthAppSelectionError(
  selectedAuthType: string,
  oauthConfigId: unknown,
  isProfileInitialized: boolean,
  isAdmin: boolean
): string | null {
  if (selectedAuthType !== 'OAUTH' || !isProfileInitialized || isAdmin !== false) {
    return null;
  }
  if (
    oauthConfigId === undefined ||
    oauthConfigId === null ||
    (typeof oauthConfigId === 'string' && oauthConfigId.trim() === '')
  ) {
    return 'Please select an OAuth app.';
  }
  return null;
}

/** Scroll the connector panel body to the first invalid sync custom field (matches auth step UX). */
function scrollToFirstSyncCustomFieldError(
  syncCustomFields: { name: string }[],
  syncFieldErrors: Record<string, string>
) {
  const name = syncCustomFields.find((f) => syncFieldErrors[f.name])?.name;
  if (!name) return;
  requestAnimationFrame(() => {
    document
      .querySelector(`[data-ph-field="${name}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

// ========================================
// Component
// ========================================

export function ConnectorPanel() {
  const router = useRouter();
  const isAdmin = useUserStore(selectIsAdmin);
  const isProfileInitialized = useUserStore(selectIsProfileInitialized);
  const addToast = useToastStore((s) => s.addToast);
  const {
    isPanelOpen,
    panelConnector,
    panelConnectorId,
    panelActiveTab,
    panelView,
    connectorSchema,
    connectorConfig,
    isLoadingSchema,
    isLoadingConfig,
    isSavingAuth,
    isSavingConfig,
    authState,
    selectedAuthType,
    instanceName,
    instanceNameError,
    formData,
    conditionalDisplay,
    registryConnectors,
    closePanel,
    setPanelActiveTab,
    setSchemaAndConfig,
    setIsLoadingSchema,
    setIsLoadingConfig,
    setSchemaError,
    setInstanceName,
    setInstanceNameError,
    mergeFormErrors,
    setIsSavingAuth,
    setIsSavingConfig,
    setSaveError,
    setAuthState,
    setShowConfigSuccessDialog,
    setNewlyConfiguredConnectorId,
    bumpCatalogRefresh,
    oauthAuthorizeUiEpoch,
    selectedScope,
  } = useConnectorsStore();

  const openInstancePanel = useConnectorsStore((s) => s.openInstancePanel);

  const [syncSaveConfirmOpen, setSyncSaveConfirmOpen] = useState(false);
  const [syncSaveConfirmKind, setSyncSaveConfirmKind] = useState<'manual' | 'wide_sync'>('wide_sync');
  const [disableFirstConfigSaveOpen, setDisableFirstConfigSaveOpen] = useState(false);

  const connectorPanelNestedModalHost = useWorkspaceDrawerNestedModalHost(isPanelOpen);

  const isCreateMode = !panelConnectorId;
  const isLoading = isLoadingSchema || isLoadingConfig;
  const connectorName = panelConnector?.name ?? '';
  const connectorType = panelConnector?.type ?? '';
  const storedListAuthType = panelConnectorId ? (panelConnector?.authType ?? '') : '';
  const schemaTypes = connectorSchema?.auth?.supportedAuthTypes ?? [];
  // Once the schema is loaded, only treat the stored authType as authoritative if the
  // schema still supports it. This prevents the Authorize tab from persisting on
  // connectors whose auth type was migrated (e.g. OAUTH → CUSTOM).
  const resolvedListAuthForOAuth =
    storedListAuthType &&
    (!connectorSchema || schemaTypes.length === 0 || schemaTypes.includes(storedListAuthType))
      ? storedListAuthType
      : '';
  /** Prefer list row `authType` when editing an instance so tabs stay correct before config fetch. */
  const authTypeForOAuthUi =
    resolvedListAuthForOAuth ||
    selectedAuthType ||
    connectorConfig?.authType ||
    panelConnector?.authType ||
    '';
  const showAuthorizeTab = Boolean(panelConnectorId && isOAuthType(authTypeForOAuthUi));
  // Prefer schema-resolved selectedAuthType over the stored connectorConfig?.authType so that
  // connectors migrated from OAUTH→CUSTOM (old DB rows carry "OAUTH") still unlock the
  // Configure tab once CUSTOM credentials have been saved.
  const authTypeForConfigureGate =
    selectedAuthType || connectorConfig?.authType || panelConnector?.authType || '';
  /**
   * OAuth gate: inferred auth from GET `/config` (incl. nested tokens), explicit `false` on
   * config over stale list rows, else list-row while config omits a top-level flag.
   */
  const instanceAuthenticated = isConnectorInstanceAuthenticatedForUi(
    panelConnectorId,
    panelConnector,
    connectorConfig
  );
  const configureTabEnabled =
    Boolean(connectorConfig) &&
    (isNoneAuthType(authTypeForConfigureGate) ||
      !isOAuthType(authTypeForConfigureGate) ||
      instanceAuthenticated);
  // Use registry connector's display name so the panel always shows the type name
  // (e.g. "Pipeshub docs") rather than an instance name when creating a new connector.
  const connectorTypeName = registryConnectors.find((c) => c.type === connectorType)?.name ?? connectorName;

  const prevPanelTabRef = useRef<PanelTab | null>(null);
  /** Bumped when the panel open-fetch effect re-runs or the drawer closes so stale requests cannot flip loaders. */
  const panelOpenFetchGen = useRef(0);

  // ── Fetch schema + config on panel open ──────────────────────
  useEffect(() => {
    if (!isPanelOpen || !connectorType) {
      panelOpenFetchGen.current += 1;
      return;
    }

    const gen = ++panelOpenFetchGen.current;
    const instanceKey = panelConnectorId ?? '';

    const fetchData = async () => {
      setIsLoadingSchema(true);
      setSchemaError(null);
      if (!isCreateMode) {
        setIsLoadingConfig(true);
      }
      try {
        if (isCreateMode) {
          const schemaRes = await ConnectorsApi.getConnectorSchema(connectorType);
          if (gen !== panelOpenFetchGen.current) return;
          const s = useConnectorsStore.getState();
          if (s.panelConnector?.type !== connectorType || (s.panelConnectorId ?? '') !== instanceKey) {
            return;
          }
          setSchemaAndConfig(schemaRes.schema);
        } else {
          const [schemaRes, configRes] = await Promise.all([
            ConnectorsApi.getConnectorSchema(connectorType),
            ConnectorsApi.getConnectorConfig(panelConnectorId!),
          ]);
          if (gen !== panelOpenFetchGen.current) return;
          const s = useConnectorsStore.getState();
          if (
            s.panelConnector?.type !== connectorType ||
            s.panelConnectorId !== panelConnectorId
          ) {
            return;
          }
          setSchemaAndConfig(schemaRes.schema, configRes);
        }
      } catch (err: unknown) {
        if (gen !== panelOpenFetchGen.current) return;
        const s = useConnectorsStore.getState();
        if (s.panelConnector?.type !== connectorType || (s.panelConnectorId ?? '') !== instanceKey) {
          return;
        }
        const message = err instanceof Error ? err.message : 'Failed to load connector configuration';
        setSchemaError(message);
      } finally {
        if (gen === panelOpenFetchGen.current) {
          setIsLoadingSchema(false);
          setIsLoadingConfig(false);
        }
      }
    };

    void fetchData();
  }, [isPanelOpen, connectorType, isCreateMode, panelConnectorId, setSchemaAndConfig, setSchemaError, setIsLoadingSchema, setIsLoadingConfig]);

  // If auth type changes away from OAuth, leave the Authorize tab value so Radix Tabs does not break.
  useEffect(() => {
    if (panelActiveTab === 'authorize' && !showAuthorizeTab) {
      setPanelActiveTab('authenticate');
    }
  }, [panelActiveTab, showAuthorizeTab, setPanelActiveTab]);

  /**
   * Do not stay on Configure when the instance is not authenticated (e.g. stale tab or API catch-up).
   * `instanceAuthenticated` uses {@link isConnectorInstanceAuthenticatedForUi}: config-based inference and
   * explicit `isAuthenticated:false` win over the catalog row so we do not bounce incorrectly during GET /config lag;
   * see ordering documented on that helper before changing deps or tab logic here.
   */
  useEffect(() => {
    if (!isPanelOpen || isLoading) return;
    if (panelActiveTab !== 'configure' || configureTabEnabled) return;
    // After `openPanel`, config is cleared until GET /config completes — do not use stale/absent config to switch tabs.
    if (panelConnectorId && !connectorConfig) return;
    if (showAuthorizeTab && !instanceAuthenticated) {
      setPanelActiveTab('authorize');
    } else {
      setPanelActiveTab('authenticate');
    }
  }, [
    isPanelOpen,
    isLoading,
    panelActiveTab,
    configureTabEnabled,
    showAuthorizeTab,
    instanceAuthenticated,
    panelConnectorId,
    connectorConfig,
    setPanelActiveTab,
  ]);

  /** Reload schema + config so the Authenticate tab shows saved credentials after navigating back. */
  const refreshPanelFromServer = useCallback(async () => {
    const id = useConnectorsStore.getState().panelConnectorId;
    const type = useConnectorsStore.getState().panelConnector?.type;
    if (!id || !type) return;
    try {
      setIsLoadingConfig(true);
      const [schemaRes, configRes] = await Promise.all([
        ConnectorsApi.getConnectorSchema(type),
        ConnectorsApi.getConnectorConfig(id),
      ]);
      const s = useConnectorsStore.getState();
      if (s.panelConnectorId !== id || s.panelConnector?.type !== type) return;
      setSchemaAndConfig(schemaRes.schema, configRes);
    } catch {
      // leave existing form; user can retry
    } finally {
      const s = useConnectorsStore.getState();
      if (s.panelConnectorId === id && s.panelConnector?.type === type) {
        setIsLoadingConfig(false);
      }
    }
  }, [setSchemaAndConfig, setIsLoadingConfig]);

  /**
   * Belt-and-suspenders re-fetch used after OAuth completion. Skips `setIsLoadingConfig` so
   * the panel body doesn't flash the full-panel loader — `checkAuthStatus` already committed the
   * authenticated config; this just ensures the Authenticate tab form data is also up-to-date.
   */
  const refreshPanelSilent = useCallback(async () => {
    const id = useConnectorsStore.getState().panelConnectorId;
    const type = useConnectorsStore.getState().panelConnector?.type;
    if (!id || !type) return;
    try {
      const [schemaRes, configRes] = await Promise.all([
        ConnectorsApi.getConnectorSchema(type),
        ConnectorsApi.getConnectorConfig(id),
      ]);
      const s = useConnectorsStore.getState();
      if (s.panelConnectorId !== id || s.panelConnector?.type !== type) return;
      setSchemaAndConfig(schemaRes.schema, configRes);
    } catch {
      // non-fatal — checkAuthStatus already committed the panel state
    }
  }, [setSchemaAndConfig]);

  const { requestRefresh: requestDrawerBodyRefresh, refreshNonce: drawerBodyRefreshNonce } =
    useWorkspaceRightPanelBodyRefresh();
  const { startOAuthPopup, isAuthenticating: isOAuthPopupBusy } = useConnectorOAuthPopup({
    onDrawerBodyRefresh: requestDrawerBodyRefresh,
    onAfterConnectorOAuthHydrate: refreshPanelSilent,
  });

  /**
   * Refetch config whenever the active tab changes (user click or programmatic), not only
   * via Radix `onValueChange` (programmatic `setPanelActiveTab` often skips that callback).
   */
  useEffect(() => {
    if (!isPanelOpen || !panelConnectorId) {
      prevPanelTabRef.current = null;
      return;
    }
    const prev = prevPanelTabRef.current;
    prevPanelTabRef.current = panelActiveTab;
    if (
      prev !== null &&
      prev !== panelActiveTab &&
      (panelActiveTab === 'authenticate' ||
        panelActiveTab === 'authorize' ||
        panelActiveTab === 'configure')
    ) {
      void refreshPanelFromServer();
    }
  }, [isPanelOpen, panelConnectorId, panelActiveTab, refreshPanelFromServer]);

  // ── Save handlers ────────────────────────────────────────────

  const resolveAuthenticateOrReturn = useCallback((): boolean => {
    if (!connectorSchema) {
      setSaveError("Loading configuration…");
      return false;
    }
    const { linkedOAuthAppId: oauthConfigIdStr, oauthFieldVisibility } = resolveOAuthFieldVisibility(
      formData.auth,
      connectorConfig,
      isCreateMode,
      isAdmin
    );

    const vFields = visibleAuthSchemaFields(
      connectorSchema.auth,
      selectedAuthType,
      conditionalDisplay,
      selectedAuthType === 'OAUTH' ? oauthFieldVisibility : null
    );
    const clearPatch: Record<string, null> = { oauthConfigId: null };
    if (selectedAuthType === 'OAUTH') {
      clearPatch.oauthInstanceName = null;
    }
    for (const f of vFields) {
      clearPatch[f.name] = null;
    }
    mergeFormErrors(clearPatch);
    setInstanceNameError(null);
    setSaveError(null);

    const oauthErrEarly = oauthAppSelectionError(
      selectedAuthType,
      oauthConfigIdStr,
      isProfileInitialized,
      isAdmin
    );
    if (oauthErrEarly) {
      mergeFormErrors({ oauthConfigId: oauthErrEarly });
      requestAnimationFrame(() => {
        document
          .querySelector('[data-ph-oauth-app-select]')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      if (
        isCreateMode &&
        selectedScope === 'personal' &&
        selectedAuthType === 'OAUTH' &&
        isProfileInitialized &&
        isAdmin === false &&
        connectorType
      ) {
        const oauthSnap = useConnectorsStore.getState();
        const listReady =
          oauthSnap.oauthAppsListPhase === 'ready' &&
          oauthSnap.oauthAppsListConnectorType === connectorType &&
          oauthSnap.oauthAppsListFetchError == null;
        if (listReady && oauthSnap.oauthAppsList.length === 0) {
          addToast({
            variant: 'warning',
            title: "No OAuth apps are available for this connector",
            description: `Ask your workspace administrator to create an OAuth app for ${connectorTypeName || "this connector"} first, then try again.`,
            duration: 4500,
          });
        }
      }
      return false;
    }

    if (selectedAuthType === 'OAUTH' && isAdmin === true && !oauthConfigIdStr) {
      const oauthAppName = (formData.auth.oauthInstanceName as string | undefined)?.trim();
      if (!oauthAppName) {
        mergeFormErrors({
          oauthInstanceName: "Enter a name for the new OAuth app.",
        });
        requestAnimationFrame(() => {
          document
            .querySelector('[data-ph-oauth-app-name]')
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        return false;
      }
    }

    if (isCreateMode && !instanceName.trim()) {
      setInstanceNameError("Enter an instance name.");
      requestAnimationFrame(() => {
        document
          .querySelector('[data-ph-connector-instance-name]')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      return false;
    }

    const fieldErrs = collectAuthFieldErrors(
      vFields,
      formData.auth,
      (f) => `${f.displayName} is required`,
      (f) => `${f.displayName} must be true`
    );
    if (Object.keys(fieldErrs).length > 0) {
      mergeFormErrors(fieldErrs);
      const first = Object.keys(fieldErrs)[0];
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-ph-field="${first}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      return false;
    }

    return true;
  }, [
    connectorSchema,
    selectedAuthType,
    conditionalDisplay,
    formData.auth,
    connectorConfig,
    isProfileInitialized,
    isAdmin,
    isCreateMode,
    selectedScope,
    connectorType,
    connectorTypeName,
    instanceName,
    mergeFormErrors,
    setInstanceNameError,
    setSaveError,
    addToast,
  ]);

  const handleSaveAuth = useCallback(async () => {
    if (!resolveAuthenticateOrReturn()) {
      return;
    }
    setIsSavingAuth(true);

    if (isCreateMode) {
      // Create mode: POST /connectors
      try {
        setSaveError(null);

        const result = (await ConnectorsApi.createConnectorInstance({
          connectorType,
          instanceName: instanceName.trim(),
          scope: selectedScope,
          authType: selectedAuthType,
          config: {
            auth: {
              ...trimAuthPayloadForApi(formData.auth),
              connectorScope: selectedScope,
            },
          },
          baseUrl: window.location.origin,
        })) as {
          connector?: { connectorId?: string };
          _key?: string;
          connectorId?: string;
        };

        const newConnectorId =
          result?.connector?.connectorId ?? result?._key ?? result?.connectorId;
        if (!newConnectorId) {
          setSaveError('Create succeeded but no connector id was returned');
          return;
        }

        addToast({
          variant: 'success',
          title: `Connector instance '${instanceName.trim()}' created successfully`,
          duration: 3000,
        });

        useConnectorsStore.setState({
          panelConnectorId: newConnectorId,
          isAuthTypeImmutable: true,
        });

        // Load merged schema + saved config so the Configure tab enables and filters/sync hydrate.
        try {
          setIsLoadingConfig(true);
          const [schemaRes, configRes] = await Promise.all([
            ConnectorsApi.getConnectorSchema(connectorType),
            ConnectorsApi.getConnectorConfig(newConnectorId),
          ]);
          setSchemaAndConfig(schemaRes.schema, configRes);
        } catch {
          setSaveError('Connector was created but configuration could not be loaded. Try reopening the panel.');
        } finally {
          setIsLoadingConfig(false);
        }

        if (isNoneAuthType(selectedAuthType)) {
          setAuthState('success');
        }

        bumpCatalogRefresh();
        if (isOAuthType(selectedAuthType) && !isNoneAuthType(selectedAuthType)) {
          setPanelActiveTab('authorize');
        } else {
          setPanelActiveTab('configure');
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to create connector";
        setSaveError(message);
      } finally {
        setIsSavingAuth(false);
      }
    } else {
      // Edit mode: PUT /config/auth
      try {
        setSaveError(null);

        await ConnectorsApi.saveAuthConfig(panelConnectorId!, {
          auth: {
            ...trimAuthPayloadForApi(formData.auth),
            connectorScope: selectedScope,
          },
          baseUrl: window.location.origin,
        });

        const editId = panelConnectorId!;
        const editType = connectorType;
        let configRes: Awaited<ReturnType<typeof ConnectorsApi.getConnectorConfig>> | null = null;
        try {
          setIsLoadingConfig(true);
          const [schemaRes, fetched] = await Promise.all([
            ConnectorsApi.getConnectorSchema(connectorType),
            ConnectorsApi.getConnectorConfig(panelConnectorId!),
          ]);
          configRes = fetched;
          const s = useConnectorsStore.getState();
          if (s.panelConnectorId === editId && s.panelConnector?.type === editType) {
            setSchemaAndConfig(schemaRes.schema, configRes);
          }
        } catch {
          // Non-fatal — user can reopen panel
        } finally {
          const s = useConnectorsStore.getState();
          if (s.panelConnectorId === editId && s.panelConnector?.type === editType) {
            setIsLoadingConfig(false);
          }
        }

        if (isOAuthType(selectedAuthType)) {
          setPanelActiveTab(
            isConnectorConfigAuthenticated(configRes) ? 'configure' : 'authorize'
          );
        } else {
          setPanelActiveTab('configure');
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to save auth configuration";
        setSaveError(message);
      } finally {
        setIsSavingAuth(false);
      }
    }
  }, [
    isCreateMode,
    selectedScope,
    resolveAuthenticateOrReturn,
    instanceName,
    connectorType,
    selectedAuthType,
    formData.auth,
    panelConnectorId,
    bumpCatalogRefresh,
    setSchemaAndConfig,
    setIsLoadingConfig,
    setAuthState,
    setPanelActiveTab,
    setIsSavingAuth,
    setSaveError,
    addToast,
    selectedScope,
  ]);

  const performSaveConfig = useCallback(async () => {
    const currentConnectorId =
      panelConnectorId || useConnectorsStore.getState().panelConnectorId;

    if (!currentConnectorId) {
      setSaveError('No connector ID found. Please complete authentication first.');
      return;
    }

    setSaveError(null);

    const syncCustomFields = connectorSchema?.sync?.customFields ?? [];
    const trimmedCustomValues = trimConnectorConfig(
      formData.sync.customValues
    ) as Record<string, unknown>;
    const syncFieldErrors = collectSyncCustomFieldErrors(syncCustomFields, trimmedCustomValues);

    const syncErrorPatch: Record<string, string | null | undefined> = {};
    for (const f of syncCustomFields) {
      syncErrorPatch[f.name] = syncFieldErrors[f.name] ?? '';
    }
    mergeFormErrors(syncErrorPatch);

    if (Object.keys(syncFieldErrors).length > 0) {
      scrollToFirstSyncCustomFieldError(syncCustomFields, syncFieldErrors);
      return;
    }

    try {
      setIsSavingConfig(true);
      const syncPayload: {
        selectedStrategy: string;
        customValues: Record<string, unknown>;
        scheduledConfig?: Record<string, unknown>;
        [key: string]: unknown;
      } = {
        selectedStrategy: formData.sync.selectedStrategy,
        customValues: trimmedCustomValues,
        // Spread custom values at the top level (required by backend for validation)
        ...trimmedCustomValues,
      };

      if (formData.sync.selectedStrategy === 'SCHEDULED') {
        syncPayload.scheduledConfig = {
          intervalMinutes: formData.sync.scheduledConfig.intervalMinutes ?? 60,
          ...(formData.sync.scheduledConfig.timezone
            ? { timezone: formData.sync.scheduledConfig.timezone }
            : {}),
          ...(formData.sync.scheduledConfig.startDateTime
            ? { startDateTime: formData.sync.scheduledConfig.startDateTime }
            : {}),
        };
      }

      await ConnectorsApi.saveFiltersSyncConfig(currentConnectorId, {
        sync: syncPayload,
        filters: {
          sync: { values: formData.filters.sync },
          indexing: { values: formData.filters.indexing },
        },
        baseUrl: window.location.origin,
      });

      // After successful save, navigate to the connector type page
      // and show the success dialog
      const savedConnectorType = connectorType;
      const scope = useConnectorsStore.getState().selectedScope;

      // Close the configuration panel
      closePanel();

      // Navigate to connector type page with connectorType query param
      // and trigger the success dialog
      if (savedConnectorType) {
        setNewlyConfiguredConnectorId(currentConnectorId);
        setShowConfigSuccessDialog(true);
        bumpCatalogRefresh();
        router.push(
          `/workspace/connectors/${scope}/?connectorType=${encodeURIComponent(savedConnectorType)}`
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save configuration";
      setSaveError(message);
    } finally {
      setIsSavingConfig(false);
    }
  }, [
    panelConnectorId,
    formData,
    connectorSchema,
    mergeFormErrors,
    closePanel,
    connectorType,
    router,
    setShowConfigSuccessDialog,
    setNewlyConfiguredConnectorId,
    bumpCatalogRefresh,
    setSaveError,
    setIsSavingConfig,
  ]);

  const handleSaveConfig = useCallback(() => {
    const currentConnectorId =
      panelConnectorId || useConnectorsStore.getState().panelConnectorId;

    if (!currentConnectorId) {
      setSaveError('No connector ID found. Please complete authentication first.');
      return;
    }

    setSaveError(null);

    const syncCustomFields = connectorSchema?.sync?.customFields ?? [];
    const trimmedCustomValues = trimConnectorConfig(
      formData.sync.customValues
    ) as Record<string, unknown>;
    const syncFieldErrors = collectSyncCustomFieldErrors(syncCustomFields, trimmedCustomValues);

    const syncErrorPatch: Record<string, string | null | undefined> = {};
    for (const f of syncCustomFields) {
      syncErrorPatch[f.name] = syncFieldErrors[f.name] ?? '';
    }
    mergeFormErrors(syncErrorPatch);

    if (Object.keys(syncFieldErrors).length > 0) {
      scrollToFirstSyncCustomFieldError(syncCustomFields, syncFieldErrors);
      return;
    }

    const syncFields = connectorSchema?.filters?.sync?.schema?.fields;
    const manualOn = isManualIndexingEnabled(formData.filters.indexing);
    const hasSync = hasAnySyncFiltersSelected(syncFields, formData.filters.sync);

    // Active-connector check comes first: disable + save in one step, skipping
    // the sync-settings warning (re-enabling later will reflect the new config).
    if (panelConnector?.isActive) {
      setDisableFirstConfigSaveOpen(true);
      return;
    }

    // For already-disabled connectors, warn about risky sync settings.
    if (manualOn || !hasSync) {
      setSyncSaveConfirmKind(manualOn ? 'manual' : 'wide_sync');
      setSyncSaveConfirmOpen(true);
      return;
    }

    void performSaveConfig();
  }, [
    panelConnectorId,
    panelConnector,
    connectorSchema,
    formData.sync.customValues,
    formData.filters.sync,
    formData.filters.indexing,
    mergeFormErrors,
    performSaveConfig,
    setSaveError,
  ]);

  const handleConfirmSyncSave = useCallback(() => {
    setSyncSaveConfirmOpen(false);
    // The active-connector check runs before the sync-confirm dialog opens,
    // so the connector is guaranteed to be inactive by the time we reach here.
    void performSaveConfig();
  }, [performSaveConfig]);

  const isAuthReady =
    authState === 'success' || isNoneAuthType(selectedAuthType);

  const handleBackFromConfigure = useCallback(async () => {
    await refreshPanelFromServer();
    if (showAuthorizeTab) {
      setPanelActiveTab('authorize');
    } else {
      setPanelActiveTab('authenticate');
    }
  }, [refreshPanelFromServer, showAuthorizeTab, setPanelActiveTab]);

  const handleBackFromAuthorize = useCallback(async () => {
    await refreshPanelFromServer();
    setPanelActiveTab('authenticate');
  }, [refreshPanelFromServer, setPanelActiveTab]);

  // When the panel was opened via "Manage Configuration" from the InstanceManagementPanel,
  // panelConnectorId matches an entry in `instances`. Use that to wire up the back button.
  // The selector is scoped to only the one matching instance so that unrelated instance
  // updates (e.g. background status polling) do not cause ConnectorPanel to re-render.
  const sourceInstance = useConnectorsStore((s) =>
    s.panelConnectorId
      ? (s.instances.find((i) => i._key === s.panelConnectorId) ?? null)
      : null
  );

  const handleBackToInstance = useCallback(() => {
    if (!sourceInstance) return;
    closePanel();
    openInstancePanel(sourceInstance);
  }, [sourceInstance, closePanel, openInstancePanel]);

  const footerConfig = getFooterConfig({
    panelView,
    panelActiveTab,
    isAuthReady,
    hasConnectorId: !!panelConnectorId,
    authTypeForConfigureGate,
    instanceAuthenticated,
    isSavingAuth,
    isSavingConfig,
    isLoadingSchema,
    isLoadingConfig,
    onNext: handleSaveAuth,
    onSave: handleSaveConfig,
    labels: {
      next: "Next",
      saving: "Saving...",
      cancel: "Cancel",
      loadingConfig: "Loading configuration…",
      saveConfig: "Save Configuration",
      completeAuthForSave: "Complete authentication first to save configuration",
      continueToConfigure: "Continue to configuration →",
      oauthInProgress: "Finish signing in with your provider…",
      authBeforeConfigure: "Complete OAuth authorization before configuring sync and filters",
      backToAuth: "← Back to credentials",
      backFromConfigure: "← Back",
    },
    onContinueFromAuthorize: async () => {
      await refreshPanelFromServer();
      setPanelActiveTab('configure');
    },
    onBackFromConfigure: handleBackFromConfigure,
    onBackFromAuthorize: handleBackFromAuthorize,
    isOAuthPopupBusy,
  });

  // ── Header ───────────────────────────────────────────────────

  const documentationUrl = getConnectorDocumentationUrl(
    panelConnector,
    connectorSchema != null ? (connectorSchema.documentationLinks ?? []) : undefined
  );

  const headerActions = documentationUrl ? (
    <Button
      variant="outline"
      color="gray"
      size="1"
      aria-label="Documentation"
      onClick={() => {
        window.open(documentationUrl, '_blank', 'noopener,noreferrer');
      }}
      style={{ cursor: 'pointer', gap: 'var(--space-1)' }}
    >
      <MaterialIcon name="open_in_new" size={14} color="var(--gray-11)" />
      <Text size="1">{"Documentation"}</Text>
    </Button>
  ) : null;

  // ── Render panel icon as img (connector icon) ────────────────

  const panelIcon = panelConnector ? (
    <ConnectorIcon type={panelConnector.type} size={16} />
  ) : undefined;

  return (
    <>
    <WorkspaceRightPanel
      open={isPanelOpen}
      onOpenChange={(open) => {
        if (!open) closePanel();
      }}
      title={`${connectorTypeName} Configuration`}
      icon={panelIcon}
      onBack={sourceInstance ? handleBackToInstance : undefined}
      headerActions={headerActions}
      hideFooter={panelView === 'select-records'}
      primaryLabel={footerConfig.primaryLabel}
      primaryDisabled={footerConfig.primaryDisabled}
      primaryLoading={footerConfig.primaryLoading}
      primaryTooltip={footerConfig.primaryTooltip}
      onPrimaryClick={footerConfig.onPrimary}
      secondaryLabel={footerConfig.secondaryLabel}
      onSecondaryClick={footerConfig.onSecondary}
    >
      {isLoading ? (
        <Flex
          align="center"
          justify="center"
          style={{ height: 200 }}
        >
          <LottieLoader variant="loader" size={48} showLabel label="Loading configuration…" />
        </Flex>
      ) : panelView === 'select-records' ? (
        <SelectRecordsPage />
      ) : (
        <Flex direction="column" style={{ height: '100%' }}>
          {/* ── Tab bar ── */}
          <Tabs.Root
            value={panelActiveTab}
            onValueChange={(v) => {
              const tab = v as PanelTab;
              if (tab === 'configure' && !configureTabEnabled) return;
              setPanelActiveTab(tab);
            }}
          >
            <Tabs.List
              style={{
                borderBottom: '1px solid var(--gray-a6)',
              }}
            >
              <Tabs.Trigger value="authenticate">
                {"Authenticate Instance"}
              </Tabs.Trigger>
              {showAuthorizeTab ? (
                <Tabs.Trigger value="authorize">Authorize</Tabs.Trigger>
              ) : null}
              <Tabs.Trigger
                value="configure"
                disabled={!configureTabEnabled}
                style={!configureTabEnabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
              >
                {"Configure Records"}
              </Tabs.Trigger>
            </Tabs.List>

            <Box style={{ paddingTop: 16 }}>
              <Tabs.Content value="authenticate">
                <AuthenticateTab />
              </Tabs.Content>
              {showAuthorizeTab ? (
                <Tabs.Content value="authorize">
                  <AuthorizeTab
                    key={`authorize-${panelConnectorId ?? 'new'}-${oauthAuthorizeUiEpoch}-${instanceAuthenticated ? '1' : '0'}-${drawerBodyRefreshNonce}`}
                    startOAuthPopup={startOAuthPopup}
                    isAuthenticating={isOAuthPopupBusy}
                  />
                </Tabs.Content>
              ) : null}
              <Tabs.Content value="configure">
                <ConfigureTab />
              </Tabs.Content>
            </Box>
          </Tabs.Root>
        </Flex>
      )}
    </WorkspaceRightPanel>
    <ConfirmationDialog
      open={syncSaveConfirmOpen}
      onOpenChange={setSyncSaveConfirmOpen}
      container={connectorPanelNestedModalHost}
      title="Start sync process?"
      message={
        syncSaveConfirmKind === 'manual'
          ? "You have enabled Manual indexing for this connector. Records will be synced but won't be searchable by AI until you index them. You can select which records to index manually from All records. Do you want to proceed?"
          : "This process could sync a large number of records. Are you sure you want to start the sync? Consider adding filters through the Filters section to reduce the number of records to sync."
      }
      confirmLabel="Confirm"
      cancelLabel="Cancel"
      confirmVariant="primary"
      onConfirm={handleConfirmSyncSave}
    />
    {panelConnectorId && (
      <DisableFirstDialog
        open={disableFirstConfigSaveOpen}
        onOpenChange={setDisableFirstConfigSaveOpen}
        connectorId={panelConnectorId}
        connectorName={connectorName || connectorTypeName}
        actionLabel="save configuration changes"
        onProceed={performSaveConfig}
        container={connectorPanelNestedModalHost}
      />
    )}
    </>
  );
}

// ========================================
// Sub-components
// ========================================


// ========================================
// Footer config helper
// ========================================

interface FooterConfig {
  primaryLabel: string;
  primaryDisabled: boolean;
  primaryLoading: boolean;
  primaryTooltip?: string;
  onPrimary?: () => void;
  secondaryLabel: string;
  onSecondary?: () => void;
}

function getFooterConfig({
  panelView,
  panelActiveTab,
  isAuthReady: _isAuthReady,
  hasConnectorId,
  authTypeForConfigureGate,
  instanceAuthenticated,
  isSavingAuth,
  isSavingConfig,
  isLoadingSchema,
  isLoadingConfig,
  onNext,
  onSave,
  labels,
  onContinueFromAuthorize,
  onBackFromConfigure,
  onBackFromAuthorize,
  isOAuthPopupBusy,
}: {
  panelView: string;
  panelActiveTab: PanelTab;
  isAuthReady: boolean;
  hasConnectorId: boolean;
  authTypeForConfigureGate: string;
  instanceAuthenticated: boolean;
  isSavingAuth: boolean;
  isSavingConfig: boolean;
  isLoadingSchema: boolean;
  isLoadingConfig: boolean;
  onNext: () => void;
  onSave: () => void;
  labels: {
    next: string;
    saving: string;
    cancel: string;
    loadingConfig: string;
    saveConfig: string;
    completeAuthForSave: string;
    continueToConfigure: string;
    oauthInProgress: string;
    authBeforeConfigure: string;
    backToAuth: string;
    backFromConfigure: string;
  };
  onContinueFromAuthorize: () => void | Promise<void>;
  onBackFromConfigure: () => void | Promise<void>;
  onBackFromAuthorize: () => void | Promise<void>;
  isOAuthPopupBusy: boolean;
}): FooterConfig {
  if (panelView === 'select-records') {
    // Footer is hidden for select-records (handled inside that component)
    return {
      primaryLabel: '',
      primaryDisabled: true,
      primaryLoading: false,
      secondaryLabel: '',
    };
  }

  if (panelActiveTab === 'authenticate') {
    return {
      primaryLabel: `${labels.next} →`,
      /** Validation runs on click; only disable while the save request is in flight. */
      primaryDisabled: isSavingAuth,
      primaryLoading: isSavingAuth,
      primaryTooltip: isSavingAuth ? labels.saving : undefined,
      onPrimary: onNext,
      secondaryLabel: labels.cancel,
    };
  }

  if (panelActiveTab === 'authorize') {
    return {
      primaryLabel: labels.continueToConfigure,
      primaryDisabled: !instanceAuthenticated || isOAuthPopupBusy,
      primaryLoading: isOAuthPopupBusy,
      primaryTooltip: isOAuthPopupBusy
        ? labels.oauthInProgress
        : !instanceAuthenticated
          ? labels.authBeforeConfigure
          : undefined,
      onPrimary: onContinueFromAuthorize,
      secondaryLabel: labels.backToAuth,
      onSecondary: () => {
        void onBackFromAuthorize();
      },
    };
  }

  // configure tab
  const configureSaveAllowed =
    hasConnectorId &&
    (instanceAuthenticated ||
      isNoneAuthType(authTypeForConfigureGate) ||
      !isOAuthType(authTypeForConfigureGate));

  const configTooltip = !hasConnectorId
    ? labels.completeAuthForSave
    : !configureSaveAllowed
    ? labels.authBeforeConfigure
    : isLoadingSchema || isLoadingConfig
    ? labels.loadingConfig
    : undefined;

  return {
    primaryLabel: labels.saveConfig,
    primaryDisabled: !configureSaveAllowed || isSavingConfig || isLoadingSchema || isLoadingConfig,
    primaryLoading: isSavingConfig,
    primaryTooltip: configTooltip,
    onPrimary: onSave,
    secondaryLabel: labels.backFromConfigure,
    onSecondary: () => {
      void onBackFromConfigure();
    },
  };
}
