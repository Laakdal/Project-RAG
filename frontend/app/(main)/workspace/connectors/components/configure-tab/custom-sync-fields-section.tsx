'use client';

import React from 'react';
import { Flex, Text } from '@radix-ui/themes';
import { SchemaFormField } from '../schema-form-field';
import type { ConnectorConfig, SyncCustomField } from '../../types';
import { isNonEditableSyncFieldLocked } from '../../utils/sync-custom-field-lock';

// ========================================
// CustomSyncFieldsSection
// ========================================

export function CustomSyncFieldsSection({
  fields,
  values,
  errors,
  onChange,
  connectorConfig,
}: {
  fields: SyncCustomField[];
  values: Record<string, unknown>;
  errors: Record<string, string>;
  onChange: (key: string, value: unknown) => void;
  connectorConfig: ConnectorConfig | null;
}) {
  return (
    <Flex
      direction="column"
      gap="4"
      style={{
        padding: 16,
        backgroundColor: 'var(--olive-2)',
        borderRadius: 'var(--radius-2)',
        border: '1px solid var(--olive-3)',
      }}
    >
      <Flex direction="column" gap="1">
        <Text size="3" weight="medium" style={{ color: 'var(--gray-12)' }}>
          {"Additional Settings"}
        </Text>
        <Text size="1" style={{ color: 'var(--gray-10)' }}>
          {"Configure connector-specific sync options"}
        </Text>
      </Flex>

      {fields.map((field) => {
        const locked = isNonEditableSyncFieldLocked(field, connectorConfig);
        return (
          <SchemaFormField
            key={field.name}
            field={field}
            value={values[field.name]}
            onChange={onChange}
            error={errors[field.name]}
            disabled={locked}
            disabledTooltip={
              locked
                ? field.fieldType === 'URL'
                  ? "The website URL can't be changed after it's set."
                  : "This value can't be changed after it's set."
                : undefined
            }
          />
        );
      })}
    </Flex>
  );
}
