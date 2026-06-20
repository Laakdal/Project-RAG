'use client';

import React from 'react';
import { Flex, Text, Tooltip } from '@radix-ui/themes';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import {
  deriveInstanceSetupStatus,
  deriveInstanceSyncOperation,
  type InstanceSetupStatusKey,
  type InstanceSyncOperationKey,
} from './instance-status';
import type { ConnectorConfig, ConnectorInstance } from '../../types';

const SYNC_ACCENT: Record<
  NonNullable<ReturnType<typeof deriveInstanceSyncOperation>>['badgeColor'],
  { bg: string; border: string; value: string }
> = {
  blue: {
    bg: 'var(--blue-a3)',
    border: 'var(--blue-a6)',
    value: 'var(--blue-11)',
  },
  red: {
    bg: 'var(--red-a3)',
    border: 'var(--red-a6)',
    value: 'var(--red-11)',
  },
};

const SETUP_VALUE_COLOR: Record<
  ReturnType<typeof deriveInstanceSetupStatus>['badgeColor'],
  string
> = {
  gray: 'var(--gray-11)',
  amber: 'var(--amber-11)',
  green: 'var(--green-11)',
};

const SETUP_LABEL: Record<InstanceSetupStatusKey, string> = {
  not_configured: "Incomplete",
  needs_authentication: "Needs auth",
  ready: "Complete",
};

const SETUP_TOOLTIP: Record<InstanceSetupStatusKey, string> = {
  not_configured: "Configuration is not finished. Open setup to complete sync and filter settings.",
  needs_authentication: "Configuration is saved but this instance still needs authentication.",
  ready: "Configuration is complete and authenticated. Sync can run when enabled.",
};

const SYNC_LABEL: Record<InstanceSyncOperationKey, string> = {
  syncing: "Syncing",
  full_syncing: "Full sync",
  deleting: "Removing",
};

const SYNC_TOOLTIP: Record<InstanceSyncOperationKey, string> = {
  syncing: "A sync job is running for this instance.",
  full_syncing: "A full sync is running for this instance.",
  deleting: "This instance is being deleted.",
};

/** Compact sync pill in the card header (no "Sync" caption). Hidden when idle. */
export function InstanceSyncOperationPill({ instance }: { instance: ConnectorInstance }) {
  const syncOp = deriveInstanceSyncOperation(instance);
  if (!syncOp) return null;

  const accent = SYNC_ACCENT[syncOp.badgeColor];
  const label = SYNC_LABEL[syncOp.key];

  return (
    <Tooltip content={SYNC_TOOLTIP[syncOp.key]}>
      <Flex
        align="center"
        gap="1"
        aria-label={label}
        style={{
          height: 32,
          padding: '0 var(--space-3)',
          borderRadius: 'var(--radius-2)',
          backgroundColor: accent.bg,
          border: `1px solid ${accent.border}`,
          flexShrink: 0,
          cursor: 'default',
        }}
      >
        <MaterialIcon name={syncOp.icon} size={14} color={accent.value} />
        <Text size="2" weight="medium" style={{ color: accent.value, whiteSpace: 'nowrap' }}>
          {label}
        </Text>
      </Flex>
    </Tooltip>
  );
}

/** Configuration / auth readiness in the property list. */
export function InstanceSetupStatusRow({
  instance,
  config,
}: {
  instance: ConnectorInstance;
  config?: ConnectorConfig;
}) {
  const setup = deriveInstanceSetupStatus(instance, config);
  const valueLabel = SETUP_LABEL[setup.key];
  const valueColor = SETUP_VALUE_COLOR[setup.badgeColor];

  return (
    <Tooltip content={SETUP_TOOLTIP[setup.key]}>
      <Flex align="center" gap="4" style={{ width: '100%' }}>
        <Text
          size="1"
          weight="medium"
          style={{
            color: 'var(--gray-10)',
            width: 164,
            flexShrink: 0,
            textTransform: 'uppercase',
            letterSpacing: '0.04px',
            lineHeight: '16px',
          }}
        >
          {"Configuration"}
        </Text>
        <Flex align="center" gap="2" style={{ minWidth: 0 }}>
          <MaterialIcon name={setup.icon} size={14} color={valueColor} />
          <Text size="2" style={{ color: valueColor, lineHeight: '20px' }}>
            {valueLabel}
          </Text>
        </Flex>
      </Flex>
    </Tooltip>
  );
}
