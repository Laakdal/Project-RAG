'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { Box, Flex, Text, Tooltip } from '@radix-ui/themes';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import {
  ThemeableAssetIcon,
  themeableAssetIconPresets,
} from '@/app/components/ui/themeable-asset-icon';
import { useUserStore, selectIsAdmin } from '@/lib/store/user-store';
import {
  WEB_SEARCH_PROVIDER_META,
  type ConfiguredWebSearchProvider,
  type WebSearchProviderMeta,
} from '../web-search-config';
import { SidebarCategoryRow } from './sidebar-category-row';
import { useWebSearchConfig } from '../hooks/use-web-search-config';
import type { AgentWebSearchAttachment } from '../types';

export interface AgentBuilderWebSearchSectionProps {
  attached: AgentWebSearchAttachment | null;
  onNotify: (message: string) => void;
  structureLocked?: boolean;
}

function buildWebSearchDragData(
  meta: WebSearchProviderMeta,
  configured: ConfiguredWebSearchProvider | null,
): Record<string, string> {
  return {
    'application/reactflow': 'web-search',
    provider: meta.type,
    providerKey: configured?.providerKey ?? '',
    providerLabel: meta.label,
    iconPath: meta.icon,
  };
}

export function AgentBuilderWebSearchSection({
  attached,
  onNotify,
  structureLocked = false,
}: AgentBuilderWebSearchSectionProps) {
  const [expanded, setExpanded] = useState(true);

  const isAdmin = useUserStore(selectIsAdmin);
  const { configuredProviders, loading } = useWebSearchConfig(true);

  const providerMap = useMemo(() => {
    const map = new Map<string, ConfiguredWebSearchProvider>();
    for (const p of configuredProviders) map.set(p.provider, p);
    return map;
  }, [configuredProviders]);

  const visibleProviders = useMemo(() => {
    if (isAdmin) return WEB_SEARCH_PROVIDER_META;
    return WEB_SEARCH_PROVIDER_META.filter(
      (meta) => !meta.configurable || providerMap.has(meta.type),
    );
  }, [isAdmin, providerMap]);

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const parentStatus = attached ? ('authenticated' as const) : undefined;

  return (
    <SidebarCategoryRow
      groupLabel={"Web Search"}
      groupMaterialIcon="public"
      groupMaterialIconColor="var(--blue-9)"
      itemCount={visibleProviders.length}
      isExpanded={expanded}
      onToggle={handleToggle}
      toolsetStatus={parentStatus}
    >
        {loading ? (
          <Text
            size="1"
            style={{
              color: 'var(--slate-11)',
              padding: '4px 8px',
              fontStyle: 'italic',
            }}
          >
            {"Loading…"}
          </Text>
        ) : (
          visibleProviders.map((meta) => {
            const configured = providerMap.get(meta.type) ?? null;
            const isAttached = attached?.provider === meta.type;
            const isConfigured = !meta.configurable || Boolean(configured);
            const dragBlocked =
              structureLocked || !isConfigured || Boolean(attached);

            return (
              <ProviderRow
                key={meta.type}
                meta={meta}
                configured={configured}
                isConfigured={isConfigured}
                isAttached={isAttached}
                dragBlocked={dragBlocked}
                anotherAttached={Boolean(attached) && !isAttached}
                onDragBlocked={() => {
                  if (structureLocked) {
                    onNotify("Web search configuration is locked.");
                  } else if (!isConfigured) {
                    onNotify(`Configure ${meta.label} before dragging it onto the canvas.`);
                  } else if (attached) {
                    onNotify("Only one web search provider can be added to the canvas at a time.");
                  }
                }}
              />
            );
          })
        )}
    </SidebarCategoryRow>
  );
}

function ProviderRow({
  meta,
  configured,
  isConfigured,
  isAttached,
  dragBlocked,
  anotherAttached,
  onDragBlocked,
}: {
  meta: WebSearchProviderMeta;
  configured: ConfiguredWebSearchProvider | null;
  isConfigured: boolean;
  isAttached: boolean;
  dragBlocked: boolean;
  anotherAttached: boolean;
  onDragBlocked: () => void;
}) {
  const dimmed = (dragBlocked && !isAttached) || (anotherAttached && !isAttached);

  return (
    <Box mb="1">
      <Flex
        align="center"
        gap="2"
        px="2"
        py="1"
        mx="1"
        draggable
        onDragStart={(e) => {
          if (dragBlocked) {
            e.preventDefault();
            onDragBlocked();
            return;
          }
          e.dataTransfer.effectAllowed = 'move';
          const data = buildWebSearchDragData(meta, configured);
          Object.entries(data).forEach(([k, v]) => {
            e.dataTransfer.setData(k, v);
          });
        }}
        style={{
          minHeight: 32,
          borderRadius: 'var(--radius-1)',
          userSelect: 'none',
          cursor: dragBlocked
            ? isAttached
              ? 'default'
              : 'not-allowed'
            : 'grab',
          opacity: dimmed ? 0.55 : 1,
        }}
        className={
          dragBlocked
            ? 'agent-builder-draggable-row agent-builder-draggable-row--disabled'
            : 'agent-builder-draggable-row'
        }
      >
        {meta.iconType === 'image' ? (
          <ThemeableAssetIcon
            {...themeableAssetIconPresets.agentBuilderCategoryRow}
            src={meta.icon}
            size={18}
          />
        ) : (
          <MaterialIcon
            name={meta.icon}
            size={18}
            color="var(--slate-11)"
            style={{ flexShrink: 0 }}
          />
        )}

        <Text
          size="2"
          style={{
            flex: 1,
            minWidth: 0,
            color: 'var(--slate-12)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {meta.label}
        </Text>

        {isAttached ? (
          <Tooltip content={"Attached"}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                flexShrink: 0,
              }}
            >
              <MaterialIcon
                name="check_circle"
                size={16}
                color="var(--accent-11)"
              />
            </span>
          </Tooltip>
        ) : isConfigured ? (
          <Tooltip content={"Configured"}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                flexShrink: 0,
              }}
            >
              <MaterialIcon
                name="check_circle"
                size={16}
                color="var(--green-9)"
              />
            </span>
          </Tooltip>
        ) : null}
      </Flex>
    </Box>
  );
}
