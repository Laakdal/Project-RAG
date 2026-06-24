'use client';

import React, { useEffect, useState } from 'react';
import { Box, Flex, Text } from '@radix-ui/themes';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import { listAttachments, type ChatAttachment } from '../rag-api';

interface ConversationFilesPanelProps {
  /** Conversation whose ingested documents to list. */
  conversationId: string;
}

/**
 * Right-side "Files in this chat" panel. Lists the documents already ingested
 * into the conversation (persisted server-side). Best-effort: a fetch failure
 * resolves to an empty list rather than surfacing a toast. Mounted only when a
 * conversation is active and the split-pane preview is not showing.
 */
export function ConversationFilesPanel({ conversationId }: ConversationFilesPanelProps) {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);

  useEffect(() => {
    let cancelled = false;
    setAttachments([]);
    listAttachments(conversationId)
      .then((list) => {
        if (!cancelled) setAttachments(list);
      })
      .catch(() => {
        if (!cancelled) setAttachments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // `failed` attachments never made it into the knowledge base, so they are not
  // really "files in this chat" — hide them from this panel.
  const visible = attachments.filter((att) => att.status !== 'failed');

  return (
    <Box
      style={{
        flex: '0 0 300px',
        height: '100%',
        overflow: 'auto',
        borderLeft: '1px solid var(--slate-6)',
        padding: 'var(--space-4)',
      }}
    >
      <Text
        size="2"
        weight="medium"
        style={{ color: 'var(--slate-11)', display: 'block', marginBottom: 'var(--space-3)' }}
      >
        Files in this chat
      </Text>

      {visible.length === 0 ? (
        <Text size="1" style={{ color: 'var(--slate-10)' }}>
          No files attached yet.
        </Text>
      ) : (
        <Flex direction="column" gap="2">
          {visible.map((att) => (
            <Flex
              key={att.id}
              align="center"
              gap="2"
              title={att.filename}
              style={{
                padding: '6px 10px',
                backgroundColor: 'var(--olive-a3)',
                border: '1px solid var(--olive-5)',
                borderRadius: 'var(--radius-3)',
              }}
            >
              <MaterialIcon name="description" size={16} color="var(--olive-11)" />
              <Text
                size="1"
                style={{
                  color: 'var(--slate-12)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {att.filename}
              </Text>
            </Flex>
          ))}
        </Flex>
      )}
    </Box>
  );
}
