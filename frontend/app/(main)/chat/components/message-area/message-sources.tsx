'use client';

import React from 'react';
import { Flex, Card, Text } from '@radix-ui/themes';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import type { ChatSource } from '../../types';
import { cleanFilename } from '../../utils/clean-filename';
import { safeHttpUrl, isWebSource } from '../../utils/source-helpers';

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

interface SourceGroup {
  title: string;
  url?: string;
  isWeb: boolean;
  /** The `[N]` number this source carries, so the footer aligns with the
   *  inline citation badges in the answer text. */
  label: string;
}

/**
 * Per-answer retrieval sources, rendered as a numbered, full-width vertical list
 * in a footer beneath the answer. Each source shows only its name (matched
 * excerpts are intentionally not displayed). Web-search results are marked with
 * a globe icon and link out; document results show a file icon.
 */
export function MessageSources({ sources }: MessageSourcesProps) {
  if (!sources || sources.length === 0) return null;

  // The same document usually matches several chunks, which would otherwise
  // repeat the filename once per chunk. Group by name so each source is a
  // single card.
  const groups: SourceGroup[] = [];
  const byName = new Map<string, SourceGroup>();
  sources.forEach((source, idx) => {
    const key = cleanFilename(source.title);
    if (byName.has(key)) return;
    const url = safeHttpUrl(source.url);
    const group: SourceGroup = {
      title: source.title,
      url,
      isWeb: isWebSource(source.title, url),
      // Prefer the source's own `[N]` label so the footer number matches the
      // inline citation badge; fall back to position if it's missing.
      label: source.citationLabel ?? String(idx + 1),
    };
    byName.set(key, group);
    groups.push(group);
  });

  return (
    <Flex direction="column" gap="2" style={{ marginTop: 'var(--space-4)', width: '100%' }}>
      <Text size="1" weight="medium" style={{ color: 'var(--slate-11)' }}>
        Sources ({groups.length})
      </Text>
      <Flex direction="column" gap="2">
        {groups.map((group, idx) => {
          const displayName = cleanFilename(group.title);
          const nameNode = (
            <Text
              size="2"
              weight="medium"
              style={{
                flex: 1,
                minWidth: 0,
                color: group.isWeb && group.url ? 'var(--accent-11)' : 'var(--slate-12)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                ...(group.isWeb && group.url ? { cursor: 'pointer' } : null),
              }}
            >
              {displayName}
            </Text>
          );

          return (
            <Card
              key={`${displayName}-${idx}`}
              style={{
                backgroundColor: 'var(--slate-2)',
                borderRadius: 'var(--radius-2)',
                padding: 'var(--space-2)',
                border: '1px solid var(--slate-6)',
              }}
            >
              <Flex gap="2" align="center">
                <SourceNumberCircle label={group.label} />
                {/* Type marker: globe for web-search results, file for documents. */}
                <MaterialIcon
                  name={group.isWeb ? 'public' : 'description'}
                  size={16}
                  color={group.isWeb ? 'var(--accent-11)' : 'var(--slate-10)'}
                  style={{ flexShrink: 0 }}
                />
                {group.isWeb && group.url ? (
                  <a
                    href={group.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ minWidth: 0, flex: 1, textDecoration: 'none' }}
                  >
                    {nameNode}
                  </a>
                ) : (
                  nameNode
                )}
              </Flex>
            </Card>
          );
        })}
      </Flex>
    </Flex>
  );
}
