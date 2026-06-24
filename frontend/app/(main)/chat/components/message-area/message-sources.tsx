'use client';

import React from 'react';
import { Flex, Card, Text } from '@radix-ui/themes';
import type { ChatSource } from '../../types';

interface MessageSourcesProps {
  sources: ChatSource[];
}

/** Small numbered circle prefixing each source card (matches the citation-badge look). */
function SourceNumberCircle({ label }: { label: string }) {
  return (
    <Flex
      align="center"
      justify="center"
      style={{
        minWidth: '18px',
        height: '18px',
        padding: '0 4px',
        borderRadius: '999px',
        background: 'var(--accent-3)',
        border: '1px solid var(--accent-a6)',
        color: 'var(--accent-11)',
        flexShrink: 0,
        lineHeight: 1,
      }}
    >
      <Text size="1" weight="bold" style={{ color: 'inherit', fontSize: '10px', lineHeight: 1 }}>
        {label}
      </Text>
    </Flex>
  );
}

/**
 * Per-answer retrieval sources, rendered as a numbered, full-width vertical list
 * in a footer beneath the answer. RAG sources only carry `{filename, chunkIndex,
 * text}`, so there is no connector icon / external URL / topics to show.
 */
export function MessageSources({ sources }: MessageSourcesProps) {
  if (!sources || sources.length === 0) return null;

  return (
    <Flex direction="column" gap="2" style={{ marginTop: 'var(--space-4)', width: '100%' }}>
      <Text size="1" weight="medium" style={{ color: 'var(--slate-11)' }}>
        Sources ({sources.length})
      </Text>
      <Flex direction="column" gap="2">
        {sources.map((source, idx) => (
          <Card
            key={source.id}
            style={{
              backgroundColor: 'var(--slate-2)',
              borderRadius: 'var(--radius-2)',
              padding: 'var(--space-2)',
              border: '1px solid var(--slate-6)',
            }}
          >
            <Flex gap="2" align="start">
              <SourceNumberCircle label={source.citationLabel ?? String(idx + 1)} />
              <Flex direction="column" gap="1" style={{ minWidth: 0, flex: 1 }}>
                <Text
                  size="2"
                  weight="medium"
                  style={{
                    color: 'var(--slate-12)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {source.title}
                </Text>

                {source.summary && (
                  <Text size="1" style={{ color: 'var(--slate-11)', lineHeight: '1.4' }}>
                    {source.summary}
                  </Text>
                )}
              </Flex>
            </Flex>
          </Card>
        ))}
      </Flex>
    </Flex>
  );
}
