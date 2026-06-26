'use client';

import React from 'react';
import { Flex, Card, Text } from '@radix-ui/themes';
import type { ChatSource } from '../../types';
import { cleanFilename } from '../../utils/clean-filename';

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

  // The same document usually matches several chunks, which would otherwise
  // repeat the filename once per chunk. Group by document so each file is a
  // single source, with its matched excerpts listed underneath.
  const groups: { title: string; excerpts: string[] }[] = [];
  const byName = new Map<string, { title: string; excerpts: string[] }>();
  for (const source of sources) {
    const key = cleanFilename(source.title);
    let group = byName.get(key);
    if (!group) {
      group = { title: source.title, excerpts: [] };
      byName.set(key, group);
      groups.push(group);
    }
    if (source.summary) group.excerpts.push(source.summary);
  }

  return (
    <Flex direction="column" gap="2" style={{ marginTop: 'var(--space-4)', width: '100%' }}>
      <Text size="1" weight="medium" style={{ color: 'var(--slate-11)' }}>
        Sources ({groups.length})
      </Text>
      <Flex direction="column" gap="2">
        {groups.map((group, idx) => (
          <Card
            key={`${cleanFilename(group.title)}-${idx}`}
            style={{
              backgroundColor: 'var(--slate-2)',
              borderRadius: 'var(--radius-2)',
              padding: 'var(--space-2)',
              border: '1px solid var(--slate-6)',
            }}
          >
            <Flex gap="2" align="start">
              <SourceNumberCircle label={String(idx + 1)} />
              <Flex direction="column" gap="1" style={{ minWidth: 0, flex: 1 }}>
                {/* Filename once, with an excerpt count when several chunks matched. */}
                <Flex align="baseline" gap="2" style={{ minWidth: 0 }}>
                  <Text
                    size="2"
                    weight="medium"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      color: 'var(--slate-12)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {cleanFilename(group.title)}
                  </Text>
                  {group.excerpts.length > 1 && (
                    <Text size="1" style={{ color: 'var(--slate-10)', flexShrink: 0 }}>
                      {group.excerpts.length} excerpts
                    </Text>
                  )}
                </Flex>

                {/* Each matched chunk, clamped to two lines and separated by a faint rule. */}
                {group.excerpts.map((excerpt, i) => (
                  <Text
                    key={`${idx}-${i}`}
                    size="1"
                    style={{
                      color: 'var(--slate-11)',
                      lineHeight: '1.4',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      ...(i > 0
                        ? { borderTop: '1px solid var(--slate-4)', paddingTop: 4, marginTop: 2 }
                        : null),
                    }}
                  >
                    {excerpt}
                  </Text>
                ))}
              </Flex>
            </Flex>
          </Card>
        ))}
      </Flex>
    </Flex>
  );
}
