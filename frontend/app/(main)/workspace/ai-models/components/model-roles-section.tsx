'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Box, Flex, Select, Text } from '@radix-ui/themes';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import { Spinner } from '@/app/components/ui/spinner';
import { toast } from '@/lib/store/toast-store';
import { AIModelsApi } from '../api';
import type { ConfiguredModel, ModelRoleAssignment } from '../types';
import { MODEL_ROLE_NAMES } from '../types';

interface ModelRolesSectionProps {
  configuredModels: Record<string, ConfiguredModel[]>;
  onRolesUpdated?: () => void;
  /**
   * 'settings' (default) — compact single-row card for the workspace settings page.
   * 'onboarding' — two-role side-by-side layout with context, shown during setup.
   */
  variant?: 'settings' | 'onboarding';
  /**
   * When true (onboarding variant), pulses the card border and shows an error
   * hint to prompt the user to make an explicit selection.
   */
  highlighted?: boolean;
  /**
   * Fires once the user makes their first explicit indexing-role selection.
   * In onboarding, this unblocks the Next button.
   */
  onAcknowledgedChange?: (acknowledged: boolean) => void;
}

function modelLabel(model: ConfiguredModel): string {
  if (model.modelFriendlyName) return model.modelFriendlyName;
  const raw = model.configuration?.model;
  if (typeof raw === 'string' && raw) return raw;
  return model.provider;
}

const INDEXING_ELIGIBLE_MODEL_TYPES = ['llm', 'slm', 'reasoning', 'multiModal'] as const;

export function ModelRolesSection({
  configuredModels,
  onRolesUpdated,
  variant = 'settings',
  highlighted = false,
  onAcknowledgedChange,
}: ModelRolesSectionProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [roles, setRoles] = useState<Record<string, ModelRoleAssignment>>({});
  /**
   * Whether the user has explicitly interacted with the dropdown.
   * In onboarding variant the dropdown starts with no value until acknowledged.
   */
  const [acknowledged, setAcknowledged] = useState(false);

  const acknowledge = useCallback(() => {
    if (!acknowledged) {
      setAcknowledged(true);
      onAcknowledgedChange?.(true);
    }
  }, [acknowledged, onAcknowledgedChange]);

  const loadRoles = useCallback(async () => {
    setLoading(true);
    try {
      const data = await AIModelsApi.getRoles();
      setRoles(data.modelRoles ?? {});
      // If an explicit assignment already exists from a previous session, treat it
      // as acknowledged so we don't block the user needlessly.
      if (data.modelRoles?.[MODEL_ROLE_NAMES.INDEXING]) {
        setAcknowledged(true);
        onAcknowledgedChange?.(true);
      }
    } catch {
      // Non-fatal — falls back to default model
    } finally {
      setLoading(false);
    }
  }, [onAcknowledgedChange]);

  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);

  const indexingCandidates: ConfiguredModel[] = INDEXING_ELIGIBLE_MODEL_TYPES.flatMap(
    (mt) => (configuredModels[mt] ?? []).map((m) => ({ ...m, modelType: mt }))
  );

  // The default LLM — used to show the query model name in onboarding view
  const allLlms: ConfiguredModel[] = INDEXING_ELIGIBLE_MODEL_TYPES.flatMap(
    (mt) => (configuredModels[mt] ?? []).map((m) => ({ ...m, modelType: mt }))
  );
  const defaultLlm = allLlms.find((m) => m.isDefault) ?? allLlms[0];

  const indexingAssignment = roles[MODEL_ROLE_NAMES.INDEXING];
  const assignedIndexingModel = indexingAssignment
    ? indexingCandidates.find((m) => m.modelKey === indexingAssignment.modelKey)
    : undefined;

  const handleIndexingRoleChange = useCallback(
    async (value: string) => {
      // Mark as acknowledged on first explicit interaction
      acknowledge();

      const updatedRoles: Record<string, ModelRoleAssignment> = { ...roles };

      if (value === '__default__') {
        delete updatedRoles[MODEL_ROLE_NAMES.INDEXING];
      } else {
        const candidate = indexingCandidates.find((m) => m.modelKey === value);
        if (!candidate) return;
        updatedRoles[MODEL_ROLE_NAMES.INDEXING] = {
          modelType: candidate.modelType,
          modelKey: candidate.modelKey,
        };
      }

      setSaving(true);
      try {
        await AIModelsApi.updateRoles(updatedRoles);
        setRoles(updatedRoles);
        toast.success("Model role assignment saved");
        onRolesUpdated?.();
      } catch {
        toast.error("Failed to save model role assignment");
      } finally {
        setSaving(false);
      }
    },
    [roles, indexingCandidates, onRolesUpdated, acknowledge]
  );

  // In onboarding variant the select has no value until the user acknowledges;
  // this forces the placeholder to display and signals that a choice is required.
  const selectValue =
    variant === 'onboarding' && !acknowledged
      ? undefined
      : (indexingAssignment?.modelKey ?? '__default__');

  const indexingSelect = (
    <Select.Root
      value={selectValue}
      onValueChange={(v) => void handleIndexingRoleChange(v)}
      disabled={saving || indexingCandidates.length === 0}
      size="2"
    >
      <Select.Trigger
        style={{ minWidth: 190, maxWidth: '100%', cursor: 'pointer' }}
        placeholder={"Select a model"}
      />
      <Select.Content>
        <Select.Item value="__default__">
          {"Same as query model"}
        </Select.Item>
        {indexingCandidates.length > 0 && <Select.Separator />}
        {indexingCandidates.map((model) => (
          <Select.Item key={model.modelKey} value={model.modelKey}>
            {modelLabel(model)}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );

  // ── Onboarding variant ─────────────────────────────────────────────────────
  if (variant === 'onboarding') {
    return (
      <Box
        className={highlighted ? 'roles-attention' : undefined}
        style={{
          border: highlighted ? '1.5px solid var(--amber-7)' : '1px solid var(--gray-4)',
          borderRadius: 'var(--radius-3)',
          background: 'var(--color-panel-solid)',
          overflow: 'hidden',
          transition: 'border-color 0.2s',
        }}
      >
        {/* Header */}
        <Flex
          align="center"
          gap="2"
          style={{
            padding: '10px 16px',
            borderBottom: highlighted ? '1px solid var(--amber-5)' : '1px solid var(--gray-4)',
            background: highlighted ? 'var(--amber-2)' : 'var(--gray-2)',
            transition: 'background 0.2s',
          }}
        >
          <MaterialIcon name="tune" size={15} style={{ color: 'var(--gray-10)' }} />
          <Text size="2" weight="medium" style={{ color: 'var(--gray-12)' }}>
            {"How will your models be used?"}
          </Text>
        </Flex>

        {/* Two-role grid */}
        <Flex
          gap="0"
          style={{ width: '100%' }}
          direction={{ initial: 'column', sm: 'row' }}
        >
          {/* ── Query & Chat (read-only) ── */}
          <Flex
            direction="column"
            gap="3"
            style={{
              flex: 1,
              padding: '16px',
              borderRight: '1px solid var(--gray-4)',
              borderBottom: '1px solid var(--gray-4)',
            }}
          >
            <Flex align="center" gap="2">
              <Flex
                align="center"
                justify="center"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 'var(--radius-2)',
                  background: 'var(--accent-3)',
                  flexShrink: 0,
                }}
              >
                <MaterialIcon name="chat" size={15} style={{ color: 'var(--accent-11)' }} />
              </Flex>
              <Flex direction="column" gap="0">
                <Text size="2" weight="medium" style={{ color: 'var(--gray-12)' }}>
                  {"Query & Chat"}
                </Text>
                <Text size="1" style={{ color: 'var(--gray-10)' }}>
                  {"Search, agents & conversations"}
                </Text>
              </Flex>
            </Flex>

            {/* Shows the configured default model as context */}
            <Flex
              align="center"
              gap="2"
              style={{
                padding: '8px 10px',
                borderRadius: 'var(--radius-2)',
                background: 'var(--gray-2)',
                border: '1px solid var(--gray-4)',
              }}
            >
              <MaterialIcon name="check_circle" size={14} style={{ color: 'var(--green-9)' }} />
              <Text size="2" style={{ color: 'var(--gray-12)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {defaultLlm ? modelLabel(defaultLlm) : "Default model"}
              </Text>
              <Badge size="1" color="green" variant="soft">
                {"Default"}
              </Badge>
            </Flex>

            <Text size="1" style={{ color: 'var(--gray-10)', lineHeight: '1.5' }}>
              {"Handles search, question answering, and AI agent responses. Use your most capable model here."}
            </Text>
          </Flex>

          {/* ── Indexing (editable) ── */}
          <Flex
            direction="column"
            gap="3"
            style={{
              flex: 1,
              padding: '16px',
              borderBottom: '1px solid var(--gray-4)',
            }}
          >
            <Flex align="center" gap="2">
              <Flex
                align="center"
                justify="center"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 'var(--radius-2)',
                  background: 'var(--gray-3)',
                  flexShrink: 0,
                }}
              >
                <MaterialIcon name="psychology" size={15} style={{ color: 'var(--gray-11)' }} />
              </Flex>
              <Flex direction="column" gap="0">
                <Text size="2" weight="medium" style={{ color: 'var(--gray-12)' }}>
                  {"Indexing Model"}
                </Text>
                <Text size="1" style={{ color: 'var(--gray-10)' }}>
                  {"Document processing"}
                </Text>
              </Flex>
            </Flex>

            <Flex align="center" gap="2">
              {(loading || saving) && <Spinner size={13} />}
              {!loading && indexingSelect}
            </Flex>

            {highlighted && !acknowledged && (
              <Flex align="center" gap="1">
                <MaterialIcon name="error_outline" size={13} style={{ color: 'var(--amber-10)' }} />
                <Text size="1" style={{ color: 'var(--amber-10)' }}>
                  {"Please choose how the indexing model should behave to continue."}
                </Text>
              </Flex>
            )}

            {acknowledged && (
              <Text size="1" style={{ color: 'var(--gray-10)', lineHeight: '1.5' }}>
                {assignedIndexingModel
                  ? `Using ${modelLabel(assignedIndexingModel)} for indexing`
                  : "Not set — falls back to your query model."}
              </Text>
            )}
          </Flex>
        </Flex>

        {/* Tip footer */}
        <Flex
          align="center"
          gap="2"
          style={{
            padding: '8px 16px',
            background: highlighted ? 'var(--amber-3)' : 'var(--amber-2)',
            borderTop: highlighted ? '1px solid var(--amber-6)' : '1px solid var(--amber-4)',
            transition: 'background 0.2s',
          }}
        >
          <MaterialIcon name="lightbulb" size={13} style={{ color: 'var(--amber-10)' }} />
          <Text size="1" style={{ color: 'var(--amber-11)', lineHeight: '1.5' }}>
            {"Assign a small, cost-efficient model (e.g. gpt-5.4-mini, gemini-2.5-flash) for indexing tasks like summarisation and classification. Keep your most capable model (e.g. gpt-5.5 claude-sonnet) for query and agents where reasoning quality matters most."}
          </Text>
        </Flex>
      </Box>
    );
  }

  // ── Settings variant (default) ─────────────────────────────────────────────
  return (
    <Box
      style={{
        border: '1px solid var(--gray-4)',
        borderRadius: 'var(--radius-3)',
        background: 'var(--color-panel-solid)',
        overflow: 'hidden',
      }}
    >
      <Flex
        align="center"
        gap="2"
        style={{
          padding: '12px 20px',
          borderBottom: '1px solid var(--gray-4)',
          background: 'var(--gray-2)',
        }}
      >
        <MaterialIcon name="tune" size={16} style={{ color: 'var(--gray-10)' }} />
        <Text size="2" weight="medium" style={{ color: 'var(--gray-12)' }}>
          {"Model Role Assignments"}
        </Text>
        <Text size="1" style={{ color: 'var(--gray-10)', marginLeft: 4 }}>
          {"Assign dedicated models for specific tasks. When not assigned, the default model is used."}
        </Text>
      </Flex>

      <Box style={{ padding: '0 20px' }}>
        <Flex
          align="center"
          justify="between"
          gap="6"
          style={{ padding: '14px 0', minHeight: 60 }}
        >
          <Flex align="center" gap="3" style={{ flex: 1, minWidth: 0 }}>
            <Flex
              align="center"
              justify="center"
              style={{
                width: 32,
                height: 32,
                borderRadius: 'var(--radius-2)',
                background: 'var(--gray-3)',
                flexShrink: 0,
              }}
            >
              <MaterialIcon name="psychology" size={16} style={{ color: 'var(--gray-11)' }} />
            </Flex>
            <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
              <Text size="2" weight="medium" style={{ color: 'var(--gray-12)' }}>
                {"Indexing Model"}
              </Text>
              <Text
                size="1"
                style={{
                  color: 'var(--gray-10)',
                  lineHeight: '1.5',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {"Model used for document summarization, classification, and data extraction during indexing. Assign a smaller, cost-effective model to reduce costs."}
              </Text>
            </Flex>
          </Flex>

          <Flex align="center" gap="2" style={{ flexShrink: 0 }}>
            {(loading || saving) && <Spinner size={14} />}
            {!loading && indexingSelect}
          </Flex>
        </Flex>
      </Box>
    </Box>
  );
}
