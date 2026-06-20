'use client';

import React, { useEffect, useCallback } from 'react';
import { Box, Flex, Text, Badge } from '@radix-ui/themes';

import { useToastStore } from '@/lib/store/toast-store';
import {
  WorkspaceRightPanel,
  FormField,
  SearchableCheckboxDropdown,
} from '../../components';
import { useGroupsStore } from '../store';
import { GroupsApi } from '../api';
import { usePaginatedUserOptions } from '../../hooks/use-paginated-user-options';

// ========================================
// Component
// ========================================

export function CreateGroupSidebar({
  onCreateSuccess,
}: {
  onCreateSuccess?: () => void;
}) {
  const addToast = useToastStore((s) => s.addToast);

  const {
    isCreatePanelOpen,
    createGroupName,
    createGroupUserIds,
    isCreating,
    closeCreatePanel,
    setCreateGroupName,
    setCreateGroupUserIds,
    setIsCreating,
    resetCreateForm,
  } = useGroupsStore();

  // Reset form when panel closes
  useEffect(() => {
    if (!isCreatePanelOpen) {
      resetCreateForm();
    }
  }, [isCreatePanelOpen, resetCreateForm]);

  // ── Paginated user options for add-users dropdown ──
  const {
    options: userOptions,
    isLoading: userFilterLoading,
    hasMore: userFilterHasMore,
    onSearch: handleUserSearch,
    onLoadMore: handleUserLoadMore,
  } = usePaginatedUserOptions({
    enabled: isCreatePanelOpen,
    idField: 'userId',
  });

  // Form validation
  const isFormValid = createGroupName.trim().length > 0;

  // Handle submit
  const handleSubmit = useCallback(async () => {
    if (!isFormValid) return;

    setIsCreating(true);
    try {
      // Step 1: Create the group
      const newGroup = await GroupsApi.createGroup(createGroupName.trim());

      // Step 2: Add users if any were selected
      if (createGroupUserIds.length > 0) {
        await GroupsApi.addUsersToGroups(createGroupUserIds, [newGroup._id]);
      }

      // Show success toast
      addToast({
        variant: 'success',
        title: "Group created!",
        description: `"${newGroup.name}" has been created successfully`,
        duration: 3000,
      });

      // Close panel and refresh parent list
      closeCreatePanel();
      onCreateSuccess?.();
    } catch {
      addToast({
        variant: 'error',
        title: "Failed to create group",
        duration: 5000,
      });
    } finally {
      setIsCreating(false);
    }
  }, [
    isFormValid,
    createGroupName,
    createGroupUserIds,
    setIsCreating,
    closeCreatePanel,
    onCreateSuccess,
    addToast,
  ]);

  return (
    <WorkspaceRightPanel
      open={isCreatePanelOpen}
      onOpenChange={(open) => {
        if (!open) closeCreatePanel();
      }}
      title={"Create Group"}
      icon="group"
      primaryLabel={"Create Group"}
      secondaryLabel={"Cancel"}
      primaryDisabled={!isFormValid}
      primaryLoading={isCreating}
      onPrimaryClick={handleSubmit}
    >
      {/* Form card */}
      <Box
        style={{
          backgroundColor: 'var(--olive-2)',
          border: '1px solid var(--olive-3)',
          borderRadius: 'var(--radius-2)',
          padding: 'var(--space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-5)',
        }}
      >
        {/* Group Name */}
        <FormField
          label={"Group Name"}
        >
          <input
            type="text"
            value={createGroupName}
            onChange={(e) => setCreateGroupName(e.target.value)}
            placeholder={"e.g. Data Engineering"}
            style={{
              width: '100%',
              height: 'var(--space-8)',
              padding: '6px 8px',
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--slate-a5)',
              borderRadius: 'var(--radius-2)',
              fontSize: 14,
              lineHeight: '20px',
              fontFamily: 'var(--default-font-family)',
              color: 'var(--slate-12)',
              outline: 'none',
              boxSizing: 'border-box',
            }}
            onFocus={(e) => {
              e.currentTarget.style.border = '2px solid var(--accent-8)';
              e.currentTarget.style.padding = '5px 7px';
            }}
            onBlur={(e) => {
              e.currentTarget.style.border = '1px solid var(--slate-a5)';
              e.currentTarget.style.padding = '6px 8px';
            }}
          />
        </FormField>

        {/* Add Users */}
        <Flex direction="column" gap="1">
          <Flex align="center" justify="between">
            <Text
              size="2"
              weight="medium"
              style={{ color: 'var(--slate-12)' }}
            >
              {"Add Users"}
            </Text>
            <Badge variant="soft" color="gray" size="1">
              {`${createGroupUserIds.length} Selected`}
            </Badge>
          </Flex>
          <SearchableCheckboxDropdown
            options={userOptions}
            selectedIds={createGroupUserIds}
            onSelectionChange={setCreateGroupUserIds}
            placeholder={"Search or select user(s) to add to this group"}
            emptyText={"No users available"}
            showAvatar
            onSearch={handleUserSearch}
            onLoadMore={handleUserLoadMore}
            isLoadingMore={userFilterLoading}
            hasMore={userFilterHasMore}
          />
        </Flex>

        {/* Access Permissions (coming soon) */}
        <Flex direction="column" gap="1">
          <Text size="2" weight="medium" style={{ color: 'var(--slate-12)' }}>
            {"Access Permissions"}
          </Text>
          <Text size="2" style={{ color: 'var(--slate-9)' }}>
            {"Access Permissions Coming Soon"}
          </Text>
        </Flex>
      </Box>
    </WorkspaceRightPanel>
  );
}
