'use client';

import React, { useState } from 'react';
import { Flex, Box, Text } from '@radix-ui/themes';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import {
  AGENT_STRATEGIES,
  AGENT_STRATEGY_ICONS,
  AGENT_STRATEGY_LABEL,
  AGENT_STRATEGY_HINT,
} from '@/chat/components/agent-strategy-dropdown';
import type { AgentStrategy } from '@/chat/types';

export interface AgentStrategyModePanelProps {
  activeStrategy: AgentStrategy;
  onSelect: (strategy: AgentStrategy) => void;
  /** Hide the heading when a parent (e.g. bottom sheet) supplies the title */
  hideHeader?: boolean;
}

/**
 * Card-style agent strategy list matching {@link QueryModePanel} ("Different Modes of Query")
 * for visual consistency in agent-scoped chat and mobile sheets.
 */
export function AgentStrategyModePanel({
  activeStrategy,
  onSelect,
  hideHeader = false,
}: AgentStrategyModePanelProps) {
  return (
    <Flex direction="column" gap="4">
      {!hideHeader && (
        <Text
          size="1"
          weight="medium"
          style={{ color: 'var(--slate-12)' }}
        >
          {"Different Modes of Query"}
        </Text>
      )}

      <Flex direction="column" gap="2">
        {AGENT_STRATEGIES.map((id) => (
          <StrategyModeRow
            key={id}
            id={id}
            isActive={activeStrategy === id}
            onSelect={onSelect}
          />
        ))}
      </Flex>
    </Flex>
  );
}

interface StrategyModeRowProps {
  id: AgentStrategy;
  isActive: boolean;
  onSelect: (strategy: AgentStrategy) => void;
}

function StrategyModeRow({ id, isActive, onSelect }: StrategyModeRowProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <Flex
      align="center"
      justify="between"
      onClick={() => onSelect(id)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        padding: 'var(--space-3) var(--space-4)',
        borderRadius: 'var(--radius-1)',
        border: '1px solid var(--olive-3)',
        backgroundColor: isHovered ? 'var(--olive-3)' : 'var(--olive-2)',
        cursor: 'pointer',
        transition: 'background-color 0.12s ease',
      }}
    >
      <Flex direction="column" gap="1" style={{ flex: 1, minWidth: 0 }}>
        <Flex align="center" gap="2">
          <MaterialIcon
            name={AGENT_STRATEGY_ICONS[id]}
            size={20}
            color={isActive ? 'var(--mode-agent-icon)' : 'var(--slate-11)'}
          />
          <Text
            size="2"
            weight="medium"
            style={{ color: 'var(--mode-agent-fg)' }}
          >
            {AGENT_STRATEGY_LABEL[id]}
          </Text>
        </Flex>
        <Text size="1" style={{ color: 'var(--slate-11)', lineHeight: 1.45 }}>
          {AGENT_STRATEGY_HINT[id]}
        </Text>
      </Flex>

      <Flex
        align="center"
        justify="center"
        style={{
          width: '16px',
          height: '16px',
          borderRadius: '50%',
          border: isActive
            ? '5px solid var(--accent-9)'
            : '1px solid var(--slate-7)',
          flexShrink: 0,
          marginLeft: 'var(--space-3)',
        }}
      >
        <Box
          style={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            backgroundColor: isActive ? 'white' : 'var(--white-to-dark)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        />
      </Flex>
    </Flex>
  );
}
