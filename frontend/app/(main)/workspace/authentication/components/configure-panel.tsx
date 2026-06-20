'use client';

import React, { useRef, useCallback, useState } from 'react';
import { Text, Button } from '@radix-ui/themes';
import { WorkspaceRightPanel } from '../../components/workspace-right-panel';
import type { ConfigurableMethod } from '../types';
import ProviderConfigForm from './forms/provider-config-form';
import type { ProviderConfigFormRef } from './forms';

// ========================================
// Types
// ========================================

interface ConfigurePanelProps {
  open: boolean;
  method: ConfigurableMethod | null;
  onClose: () => void;
  onSaveSuccess: (method: ConfigurableMethod) => void;
}

// ── Per-method display info ────────────────────────────────

const METHOD_DOC_URLS: Record<ConfigurableMethod, string> = {
  google: '',
  microsoft: '',
  samlSso: '',
  oauth: '',
};

const METHOD_ICONS: Record<ConfigurableMethod, string> = {
  google: 'google',
  microsoft: 'window',
  samlSso: 'security',
  oauth: 'vpn_key',
};

const METHOD_TITLES: Record<ConfigurableMethod, string> = {
  google: 'Configure Google Authentication',
  microsoft: 'Configure Microsoft Authentication',
  samlSso: 'Configure SAML SSO',
  oauth: 'Configure OAuth 2.0',
};

// ========================================
// Component
// ========================================

export function ConfigurePanel({ open, method, onClose, onSaveSuccess }: ConfigurePanelProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [isFormValid, setIsFormValid] = useState(false);

  const formRef = useRef<ProviderConfigFormRef>(null);

  const handleValidChange = useCallback((valid: boolean) => {
    setIsFormValid(valid);
  }, []);

  const handleSave = async () => {
    if (!method) return;
    setIsSaving(true);
    try {
      const success = (await formRef.current?.submit()) ?? false;
      if (success) {
        onSaveSuccess(method);
        onClose();
      }
    } finally {
      setIsSaving(false);
    }
  };

  if (!method) return null;

  const docButton = (
    <Button
      variant="outline"
      color="gray"
      size="1"
      onClick={() => window.open(METHOD_DOC_URLS[method], '_blank')}
      style={{ cursor: 'pointer', gap: 'var(--space-1)' }}
    >
      <span className="material-icons-outlined" style={{ fontSize: 14 }}>open_in_new</span>
      <Text size="1">{"Documentation"}</Text>
    </Button>
  );

  return (
    <WorkspaceRightPanel
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={METHOD_TITLES[method]}
      icon={METHOD_ICONS[method]}
      headerActions={docButton}
      primaryLabel={"Save"}
      secondaryLabel={"Cancel"}
      primaryDisabled={!isFormValid}
      primaryLoading={isSaving}
      onPrimaryClick={handleSave}
      onSecondaryClick={onClose}
    >
      <ProviderConfigForm
        key={method}
        ref={formRef}
        method={method}
        onValidChange={handleValidChange}
      />
    </WorkspaceRightPanel>
  );
}
