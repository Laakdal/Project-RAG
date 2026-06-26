'use client';

import React, { useEffect, useState } from 'react';
import { Box, Flex, IconButton, Spinner, Text } from '@radix-ui/themes';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import { useChatStore } from '../store';
import { listAttachments, deleteAttachment, type ChatAttachment } from '../rag-api';
import { cleanFilename } from '../utils/clean-filename';
import { PdfPreviewDialog } from './pdf-preview-dialog';

interface ConversationFilesPanelProps {
  /** Conversation whose attached documents to list. */
  conversationId: string;
  /** Collapse the panel (the parent hides it behind an expand strip). */
  onCollapse: () => void;
}

type FileRow =
  | { key: string; name: string; kind: 'uploading' }
  | {
      key: string;
      name: string;
      kind: 'ready';
      attachmentId: string;
      chunkCount: number | null;
      hasFile: boolean;
    };

/** Uppercase extension for the format badge, e.g. "PDF", "DOCX". */
function fileBadge(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1) : '';
  return (ext || 'file').toUpperCase();
}

/**
 * Right-side "Files in this chat" panel. Lists the documents attached to the
 * conversation — both files still uploading (mirrored from the composer via the
 * store) and files already ingested server-side. Updates live: the wrapper bumps
 * `attachmentsVersion` after each upload/delete so this refetches. Best-effort —
 * a fetch failure resolves to an empty list rather than surfacing a toast.
 *
 * The parent (page.tsx) owns the panel WIDTH; this fills it (width:100%).
 */
export function ConversationFilesPanel({
  conversationId,
  onCollapse,
}: ConversationFilesPanelProps) {
  const composerUploads = useChatStore((s) => s.composerUploads);
  const attachmentsVersion = useChatStore((s) => s.attachmentsVersion);
  const bumpAttachmentsVersion = useChatStore((s) => s.bumpAttachmentsVersion);

  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  // The PDF currently open in the preview modal (null = closed).
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);

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
  }, [conversationId, attachmentsVersion]);

  // Persisted, non-failed files are the "ready" rows.
  const ready = attachments.filter((att) => att.status !== 'failed');
  const readyNames = new Set(ready.map((att) => att.filename));

  // In-flight uploads from the composer that aren't yet persisted — deduped by
  // filename so a just-finished upload doesn't show twice — skipping failures.
  const uploading = composerUploads.filter(
    (u) => u.status !== 'error' && !readyNames.has(u.name),
  );

  const rows: FileRow[] = [
    ...uploading.map((u) => ({
      key: `up-${u.id}`,
      name: u.name,
      kind: 'uploading' as const,
    })),
    ...ready.map((att) => ({
      key: `at-${att.id}`,
      name: att.filename,
      kind: 'ready' as const,
      attachmentId: att.id,
      chunkCount: att.chunkCount,
      hasFile: att.hasFile ?? false,
    })),
  ];

  const handleDelete = async (attachmentId: string) => {
    setAttachments((prev) => prev.filter((att) => att.id !== attachmentId));
    await deleteAttachment(conversationId, attachmentId);
    bumpAttachmentsVersion();
  };

  return (
    <Box style={{ width: '100%', height: '100%', overflow: 'auto', padding: 'var(--space-4)' }}>
      {/* Header: collapse button on the LEFT (mirrors the chat-list sidebar's
          keyboard_tab icon), then the title. */}
      <Flex align="center" gap="2" style={{ marginBottom: 'var(--space-3)' }}>
        <IconButton
          variant="ghost"
          size="1"
          color="gray"
          onClick={onCollapse}
          aria-label="Collapse files panel"
        >
          <MaterialIcon name="keyboard_tab" size={18} color="var(--slate-11)" />
        </IconButton>
        <Text size="2" weight="medium" style={{ color: 'var(--slate-11)' }}>
          Files in this chat
        </Text>
      </Flex>

      {rows.length === 0 ? (
        <Text size="1" style={{ color: 'var(--slate-10)' }}>
          No files attached yet.
        </Text>
      ) : (
        <Flex direction="column" gap="2">
          {rows.map((row) => {
            // A ready file with stored bytes can be opened. PDFs preview in a
            // modal; anything else (e.g. DOCX, which the server returns as a
            // download) is handed off to the browser. The relative URL goes
            // through the same-origin proxy so cookies ride along.
            const serveUrl =
              row.kind === 'ready' && row.hasFile
                ? `/chat/conversations/${conversationId}/attachments/${row.attachmentId}/file`
                : null;
            const isPdf = fileBadge(cleanFilename(row.name)) === 'PDF';
            const openFile = serveUrl
              ? () => {
                  if (isPdf) {
                    setPreview({ url: serveUrl, name: row.name });
                  } else {
                    window.open(serveUrl, '_blank', 'noopener');
                  }
                }
              : undefined;
            return (
            <Box
              key={row.key}
              title={openFile ? `Open ${cleanFilename(row.name)}` : cleanFilename(row.name)}
              onClick={openFile}
              style={{
                padding: 'var(--space-3)',
                backgroundColor: 'var(--slate-2)',
                border: '1px solid var(--slate-6)',
                borderRadius: 'var(--radius-3)',
                cursor: openFile ? 'pointer' : undefined,
              }}
            >
              {/* Filename (bold, up to 2 lines) + trailing spinner/remove. */}
              <Flex align="start" justify="between" gap="2">
                <Text
                  size="2"
                  weight="bold"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    color: 'var(--slate-12)',
                    lineHeight: 1.3,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    wordBreak: 'break-word',
                  }}
                >
                  {cleanFilename(row.name)}
                </Text>
                {row.kind === 'uploading' ? (
                  <Spinner size="1" style={{ flexShrink: 0, marginTop: 2 }} />
                ) : (
                  <IconButton
                    variant="ghost"
                    size="1"
                    color="gray"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(row.attachmentId);
                    }}
                    style={{ margin: 0, flexShrink: 0 }}
                    aria-label={`Remove ${row.name}`}
                  >
                    <MaterialIcon name="close" size={14} color="var(--slate-11)" />
                  </IconButton>
                )}
              </Flex>

              {/* Subtitle: chunk count (or upload state). */}
              <Text size="1" style={{ color: 'var(--slate-10)', display: 'block', marginTop: 4 }}>
                {row.kind === 'uploading'
                  ? 'Uploading…'
                  : row.chunkCount != null
                    ? `${row.chunkCount} chunk${row.chunkCount === 1 ? '' : 's'}`
                    : 'Attached'}
              </Text>

              {/* Format badge. */}
              <Box style={{ marginTop: 8 }}>
                <Text
                  size="1"
                  style={{
                    display: 'inline-block',
                    border: '1px solid var(--slate-6)',
                    borderRadius: 'var(--radius-2)',
                    padding: '1px 6px',
                    color: 'var(--slate-11)',
                    letterSpacing: '0.02em',
                  }}
                >
                  {fileBadge(cleanFilename(row.name))}
                </Text>
              </Box>
            </Box>
            );
          })}
        </Flex>
      )}

      <PdfPreviewDialog
        url={preview?.url ?? null}
        filename={preview?.name ?? ''}
        onClose={() => setPreview(null)}
      />
    </Box>
  );
}
