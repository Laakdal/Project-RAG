'use client';

import React, { useMemo } from 'react';
import { DropdownMenu, Button, Text, Flex } from '@radix-ui/themes';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import type { AgentStrategy } from '@/chat/types';

/** Canonical strategy order for dropdowns and mode panels — single source of truth. */
export const AGENT_STRATEGIES: readonly AgentStrategy[] = [
  'auto',
  'quick',
  'verify',
  'deep',
];

/** Material Icons names (outlined set) per strategy */
export const AGENT_STRATEGY_ICONS: Record<AgentStrategy, string> = {
  auto: 'auto_awesome',
  quick: 'bolt',
  verify: 'fact_check',
  deep: 'psychology',
};

/** Short display labels per strategy (shown in toolbar pill / trigger) */
export const AGENT_STRATEGY_SHORT: Record<AgentStrategy, string> = {
  auto: "Auto",
  quick: "Quick",
  verify: "Verify",
  deep: "Deep",
};

/** Full labels per strategy (shown in dropdown item heading) */
export const AGENT_STRATEGY_LABEL: Record<AgentStrategy, string> = {
  auto: "Auto",
  quick: "Quick",
  verify: "Verify",
  deep: "Deep",
};

/** Hint / description per strategy (shown below label in dropdown) */
export const AGENT_STRATEGY_HINT: Record<AgentStrategy, string> = {
  auto: "The system picks the best approach per step—balanced speed and thoroughness.",
  quick: "Favors fast answers and fewer refinement loops. Best for straightforward tasks.",
  verify: "Adds extra checks on facts and steps before finalizing the answer.",
  deep: "Explores more thoroughly with longer reasoning—use when accuracy matters most.",
};

export interface AgentStrategyDropdownProps {
  value: AgentStrategy;
  onChange: (next: AgentStrategy) => void;
  disabled?: boolean;
  accentColor: string;
}

export function AgentStrategyDropdown({
  value,
  onChange,
  disabled,
  accentColor,
}: AgentStrategyDropdownProps) {
  const triggerLabel = useMemo(
    () => AGENT_STRATEGY_SHORT[value] ?? value,
    [value]
  );

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger disabled={disabled}>
        <Button
          type="button"
          variant="ghost"
          color="gray"
          size="2"
          disabled={disabled}
          title={"Agent strategy"}
          style={{
            maxWidth: 'min(200px, 40vw)',
            cursor: disabled ? 'default' : 'pointer',
            flexShrink: 1,
          }}
        >
          <MaterialIcon name={AGENT_STRATEGY_ICONS[value]} size={16} color={accentColor} />
          <Text
            size="2"
            style={{
              color: 'var(--slate-12)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {triggerLabel}
          </Text>
          <MaterialIcon name="expand_more" size={16} color={accentColor} />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content
        size="2"
        sideOffset={4}
        align="end"
        style={{ minWidth: 'min(320px, calc(100vw - var(--space-6)))', maxWidth: '360px' /* was: 32px offset, delta: 0px */ }}
      >
        {AGENT_STRATEGIES.map((id) => (
          <DropdownMenu.Item
            key={id}
            data-agent-strategy-row=""
            onSelect={() => onChange(id)}
            style={{
              paddingTop: 'var(--space-2)',
              paddingBottom: 'var(--space-2)',
            }}
          >
            <Flex
              direction="row"
              gap="2"
              align="start"
              style={{ width: '100%', minWidth: 0, whiteSpace: 'normal' }}
            >
              <MaterialIcon
                name={AGENT_STRATEGY_ICONS[id]}
                size={20}
                color={accentColor}
                style={{ flexShrink: 0, marginTop: '1px' }}
              />
              <Flex
                direction="column"
                gap="1"
                align="start"
                style={{ flex: 1, minWidth: 0 }}
              >
                <Text
                  size="2"
                  weight="medium"
                  style={{ color: 'var(--slate-12)', whiteSpace: 'normal' }}
                >
                  {AGENT_STRATEGY_LABEL[id]}
                </Text>
                <Text
                  size="1"
                  style={{
                    color: 'var(--slate-11)',
                    lineHeight: 1.45,
                    whiteSpace: 'normal',
                    wordWrap: 'break-word',
                  }}
                >
                  {AGENT_STRATEGY_HINT[id]}
                </Text>
              </Flex>
            </Flex>
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
