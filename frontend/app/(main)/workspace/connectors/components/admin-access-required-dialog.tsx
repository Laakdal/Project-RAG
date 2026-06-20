'use client';

import React, { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, Button, Flex } from '@radix-ui/themes';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import type { Connector } from '../types';
import { getPersonalConnectorRedirectType } from '../utils/admin-access-helpers';

export type AdminAccessDialogPhase = 'question' | 'redirect';

export interface AdminAccessRequiredDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connector: Connector | null;
  phase: AdminAccessDialogPhase;
  onPhaseChange: (phase: AdminAccessDialogPhase) => void;
  onConfirmAdmin: () => void;
}

export function AdminAccessRequiredDialog({
  open,
  onOpenChange,
  connector,
  phase,
  onPhaseChange,
  onConfirmAdmin,
}: AdminAccessRequiredDialogProps) {
  const router = useRouter();

  const appGroup = connector?.appGroup ?? connector?.name ?? '';
  const connectorName = connector?.name ?? '';
  const personalConnectorType = getPersonalConnectorRedirectType(connector);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        onPhaseChange('question');
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, onPhaseChange]
  );

  const handleGoToPersonal = useCallback(() => {
    handleOpenChange(false);
    if (personalConnectorType) {
      router.push(
        `/workspace/connectors/personal/?connectorType=${encodeURIComponent(personalConnectorType)}`
      );
    } else {
      router.push('/workspace/connectors/personal/');
    }
  }, [handleOpenChange, personalConnectorType, router]);

  if (!connector) {
    return null;
  }

  const isQuestion = phase === 'question';

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Content
        style={{
          maxWidth: '37.5rem',
          padding: 'var(--space-5)',
          backgroundColor: 'var(--color-panel-solid)',
          borderRadius: 'var(--radius-5)',
          border: '1px solid var(--olive-a3)',
          boxShadow:
            '0 16px 36px -20px rgba(0, 6, 46, 0.2), 0 16px 64px rgba(0, 0, 85, 0.02), 0 12px 60px rgba(0, 0, 0, 0.15)',
        }}
      >
        <Flex align="center" gap="2" style={{ marginBottom: 'var(--space-2)' }}>
          <MaterialIcon
            name={isQuestion ? 'admin_panel_settings' : 'info'}
            size={20}
            color={isQuestion ? 'var(--amber-9)' : 'var(--blue-9)'}
          />
          <Dialog.Title style={{ color: 'var(--slate-12)', margin: 0 }}>
            {isQuestion
              ? "Admin access required"
              : "Use the personal connector instead"}
          </Dialog.Title>
        </Flex>

        <Dialog.Description
          size="2"
          style={{ color: 'var(--slate-11)', lineHeight: '20px', marginTop: 'var(--space-1)' }}
        >
          {isQuestion
            ? `Do you have admin access in ${appGroup}? The team connector requires admin privileges in the native app to register OAuth applications and sync organization-wide data.`
            : `The team ${connectorName} connector requires admin access in your ${appGroup} instance. Please use the ${appGroup} Personal connector to sync your own account instead.`}
        </Dialog.Description>

        <Flex justify="end" gap="2" mt="4">
          {isQuestion ? (
            <>
              <Button
                type="button"
                variant="outline"
                color="gray"
                size="2"
                onClick={() => onPhaseChange('redirect')}
              >
                {"No, I'm not an admin"}
              </Button>
              <Button type="button" variant="solid" size="2" onClick={onConfirmAdmin}>
                {"Yes, continue setup"}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                color="gray"
                size="2"
                onClick={() => handleOpenChange(false)}
              >
                {"Close"}
              </Button>
              <Button type="button" variant="solid" size="2" onClick={handleGoToPersonal}>
                {`Go to ${appGroup} Personal`}
              </Button>
            </>
          )}
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
