'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text } from '@radix-ui/themes';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/store/toast-store';
import { isProcessedError } from '@/lib/api/api-error';
import { ServiceGate } from '@/app/components/ui/service-gate';
import { useUserStore, selectIsAdmin, selectIsProfileInitialized } from '@/lib/store/user-store';
import { useAIModelsStore } from './store';
import { AIModelsApi } from './api';
import type { AIModelProvider, ConfiguredModel } from './types';
import { CAPABILITY_TO_MODEL_TYPE } from './types';
import { DestructiveTypedConfirmationDialog } from '@/app/(main)/workspace/components';
import { ProviderGrid, ModelConfigDialog, ModelRolesSection } from './components';

export default function AIModelsPage() {
  const router = useRouter();
  const isAdmin = useUserStore(selectIsAdmin);
  const isProfileInitialized = useUserStore(selectIsProfileInitialized);
  const store = useAIModelsStore();
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (isProfileInitialized && isAdmin === false) {
      router.replace('/workspace/general');
    }
  }, [isProfileInitialized, isAdmin, router]);

  const loadProviders = useCallback(async () => {
    const s = useAIModelsStore.getState();
    s.setLoadingProviders(true);
    try {
      const data = await AIModelsApi.getRegistry();
      s.setProviders(data.providers);
    } catch {
      toast.error("Failed to load AI model providers");
    } finally {
      s.setLoadingProviders(false);
    }
  }, []);

  const loadModels = useCallback(async () => {
    const s = useAIModelsStore.getState();
    s.setLoadingModels(true);
    try {
      const data = await AIModelsApi.getAllModels();
      s.setConfiguredModels(data.models as unknown as Record<string, ConfiguredModel[]>);
    } catch {
      toast.error("Failed to load configured models");
    } finally {
      s.setLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    if (!isProfileInitialized || isAdmin === false) return;
    void loadProviders();
    void loadModels();
    return () => useAIModelsStore.getState().reset();
  }, [isProfileInitialized, isAdmin, loadProviders, loadModels]);

  const handleRefresh = useCallback(() => {
    void loadProviders();
    void loadModels();
  }, [loadProviders, loadModels]);

  const handleAdd = useCallback((provider: AIModelProvider, capability: string) => {
    useAIModelsStore.getState().openAddDialog(provider, capability);
  }, []);

  const handleEdit = useCallback((provider: AIModelProvider, capability: string, model: ConfiguredModel) => {
    useAIModelsStore.getState().openEditDialog(provider, capability, model);
  }, []);

  const handleSetDefault = useCallback(
    async (modelType: string, modelKey: string) => {
      try {
        await AIModelsApi.setDefault(modelType, modelKey);
        toast.success("Default model updated");
        await loadModels();
      } catch {
        toast.error("Failed to set default model");
      }
    },
    [loadModels]
  );

  const handleDelete = useCallback(async () => {
    const target = useAIModelsStore.getState().deleteTarget;
    if (!target) return;
    setIsDeleting(true);
    try {
      await AIModelsApi.deleteProvider(target.modelType, target.modelKey);
      toast.success(`Deleted ${target.modelName}`);
      useAIModelsStore.getState().closeDeleteDialog();
      await loadModels();
    } catch (error: unknown) {
      const detail =
        isProcessedError(error) && error.message.trim() ? error.message.trim() : undefined;
      toast.error("Failed to delete model", {
        ...(detail ? { description: detail } : {}),
      });
    } finally {
      setIsDeleting(false);
    }
  }, [loadModels]);

  const dialogExistingModelsCount = useMemo(() => {
    if (store.dialogMode !== 'add') return 0;
    const capability = store.dialogCapability;
    if (!capability) return 0;
    const targetModelType = CAPABILITY_TO_MODEL_TYPE[capability];
    if (!targetModelType) return 0;
    return store.configuredModels[targetModelType]?.length ?? 0;
  }, [store.dialogMode, store.dialogCapability, store.configuredModels]);

  const isLoading = store.isLoadingProviders || store.isLoadingModels;
  const deleteKeyword = store.deleteTarget?.modelName ?? '';

  if (!isProfileInitialized || isAdmin === false) return null;

  const pagePaddingX = 'clamp(var(--space-4), 4vw, 100px)';
  const pagePaddingY = 'clamp(var(--space-6), 3vw, 64px)';

  return (
    <ServiceGate services={['query']}>
      {/* Role assignments sit above the provider grid, sharing the same page margins */}
      {store.capabilitySection === 'text_generation' && (
        <Box
          style={{
            paddingTop: pagePaddingY,
            paddingLeft: pagePaddingX,
            paddingRight: pagePaddingX,
            paddingBottom: 0,
          }}
        >
          <ModelRolesSection
            configuredModels={store.configuredModels}
            onRolesUpdated={handleRefresh}
          />
        </Box>
      )}

      <ProviderGrid
        providers={store.providers}
        configuredModels={store.configuredModels}
        searchQuery={store.searchQuery}
        onSearchChange={store.setSearchQuery}
        mainSection={store.mainSection}
        onMainSectionChange={store.setMainSection}
        capabilitySection={store.capabilitySection}
        onCapabilitySectionChange={store.setCapabilitySection}
        onAdd={handleAdd}
        onEdit={handleEdit}
        onSetDefault={handleSetDefault}
        onDelete={(mt, mk, name) => store.openDeleteDialog(mt, mk, name)}
        isLoading={isLoading}
        onRefresh={handleRefresh}
      />

      <ModelConfigDialog
        open={store.dialogOpen}
        mode={store.dialogMode}
        provider={store.dialogProvider}
        capability={store.dialogCapability}
        editModel={store.dialogEditModel}
        existingModelsCount={dialogExistingModelsCount}
        onClose={store.closeDialog}
        onSaved={() => {
          void loadModels();
        }}
      />

      <DestructiveTypedConfirmationDialog
        open={store.deleteDialogOpen}
        onOpenChange={(open) => {
          if (!open) store.closeDeleteDialog();
        }}
        heading={"Delete Model"}
        body={
          <Text size="2" style={{ color: 'var(--slate-12)', lineHeight: '20px' }}>
            {`You are about to permanently delete the configured model "${store.deleteTarget?.modelName ?? ''}". This cannot be undone.`}
          </Text>
        }
        confirmationKeyword={deleteKeyword}
        confirmInputLabel={`Type "${deleteKeyword}" to confirm`}
        primaryButtonText={"Delete"}
        cancelLabel={"Cancel"}
        isLoading={isDeleting}
        confirmLoadingLabel={"Deleting..."}
        onConfirm={() => void handleDelete()}
      />
    </ServiceGate>
  );
}
