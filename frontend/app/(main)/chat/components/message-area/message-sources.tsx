'use client';

import React, { useEffect, useState } from 'react';
import { Flex, Card, Text } from '@radix-ui/themes';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import type { ChatSource } from '../../types';
import { cleanFilename } from '../../utils/clean-filename';
import { safeHttpUrl, isWebSource } from '../../utils/source-helpers';
import { PdfPreviewDialog } from '../pdf-preview-dialog';
import { useChatStore } from '../../store';
import { listAttachments, locateAttachmentPage } from '../../rag-api';

interface MessageSourcesProps {
  sources: ChatSource[];
}

const CIRCLE_STYLE: React.CSSProperties = {
  minWidth: '18px',
  height: '18px',
  padding: '0 4px',
  borderRadius: '999px',
  background: 'var(--accent-3)',
  border: '1px solid var(--accent-a6)',
  color: 'var(--accent-11)',
  flexShrink: 0,
  lineHeight: 1,
};

/**
 * Small numbered circle prefixing each source card (matches the citation-badge
 * look). With `onClick` it becomes a button that opens the document at the page
 * that citation came from; the click is kept off the card, which opens page 1.
 */
function SourceNumberCircle({
  label,
  onClick,
  title,
}: {
  label: string;
  onClick?: () => void;
  title?: string;
}) {
  const content = (
    <Text size="1" weight="bold" style={{ color: 'inherit', fontSize: '10px', lineHeight: 1 }}>
      {label}
    </Text>
  );
  if (!onClick) {
    return (
      <Flex align="center" justify="center" style={CIRCLE_STYLE}>
        {content}
      </Flex>
    );
  }
  return (
    <button
      type="button"
      title={title}
      aria-label={title ?? `Open source ${label}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        ...CIRCLE_STYLE,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        font: 'inherit',
        appearance: 'none',
        cursor: 'pointer',
      }}
    >
      {content}
    </button>
  );
}

interface SourceGroup {
  title: string;
  url?: string;
  isWeb: boolean;
  /** Origin of the source ("This chat" = a file uploaded to this conversation). */
  origin?: string;
  /** Every `[N]` number pointing at this source, so the footer accounts for all
   *  the inline citation badges in the answer text. A long document is
   *  retrieved as several chunks, each cited under its own number, so one file
   *  can legitimately carry `[1] [2] [3]`. Each carries the retrieved chunk's
   *  text, which is what locates its page in the document. */
  labels: { label: string; text?: string }[];
}

/**
 * Per-answer retrieval sources, rendered as a numbered, full-width vertical list
 * in a footer beneath the answer. Web-search results link out. A file the user
 * uploaded to THIS chat can be previewed (PDF) or downloaded — we look up its
 * stored attachment by filename. Google Drive / library documents are shown as
 * plain, non-clickable references (they aren't served for inline preview).
 */
export function MessageSources({ sources }: MessageSourcesProps) {
  const [preview, setPreview] = useState<{ url: string; name: string; page: number } | null>(
    null,
  );
  const [attByName, setAttByName] = useState<Record<string, { id: string; hasFile: boolean }>>({});
  // The conversation currently in view — used to build the attachment serve URL.
  const convId = useChatStore((s) => (s.activeSlotId ? s.slots[s.activeSlotId]?.convId ?? null : null));
  // Only uploaded ("This chat") sources are previewable; skip the lookup otherwise.
  const hasUpload = sources?.some((s) => s.origin === 'This chat') ?? false;

  useEffect(() => {
    if (!convId || !hasUpload) return;
    let cancelled = false;
    listAttachments(convId)
      .then((rows) => {
        if (cancelled) return;
        const map: Record<string, { id: string; hasFile: boolean }> = {};
        for (const r of rows) map[r.filename] = { id: r.id, hasFile: !!r.hasFile };
        setAttByName(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [convId, hasUpload]);

  if (!sources || sources.length === 0) return null;

  // The same document usually matches several chunks, which would otherwise
  // repeat the filename once per chunk. Group by name so each source is a
  // single card, but keep every chunk's `[N]` on that card — otherwise an
  // answer citing [1] [2] [3] from one file shows a lone [1] in the footer.
  const groups: SourceGroup[] = [];
  const byName = new Map<string, SourceGroup>();
  sources.forEach((source, idx) => {
    const key = cleanFilename(source.title);
    // Prefer the source's own `[N]` label so the footer numbers match the
    // inline citation badges; fall back to position if it's missing.
    const label = source.citationLabel ?? String(idx + 1);
    const cite = { label, text: source.summary };
    const existing = byName.get(key);
    if (existing) {
      if (!existing.labels.some((l) => l.label === label)) existing.labels.push(cite);
      return;
    }
    const url = safeHttpUrl(source.url);
    const group: SourceGroup = {
      title: source.title,
      url,
      isWeb: isWebSource(source.title, url),
      origin: source.origin,
      labels: [cite],
    };
    byName.set(key, group);
    groups.push(group);
  });
  // Numeric order, so a card reads [1] [2] [3] rather than retrieval order.
  for (const group of groups) group.labels.sort((a, b) => Number(a.label) - Number(b.label));

  return (
    <Flex direction="column" gap="2" style={{ marginTop: 'var(--space-4)', width: '100%' }}>
      <Text size="1" weight="medium" style={{ color: 'var(--slate-11)' }}>
        Sources ({groups.length})
      </Text>
      <Flex direction="column" gap="2">
        {groups.map((group, idx) => {
          const displayName = cleanFilename(group.title);
          // A file uploaded to this chat can be opened: match it to its stored
          // attachment and serve the bytes through the same-origin proxy (cookie
          // rides along). PDFs preview in the modal; other types download.
          // Google Drive / library sources are left as plain references.
          const att = group.origin === 'This chat' ? attByName[group.title] : undefined;
          const serveUrl =
            att && att.hasFile && convId
              ? `/chat/conversations/${convId}/attachments/${att.id}/file`
              : null;
          const isPdf = /\.pdf$/i.test(group.title);
          const openFile = serveUrl
            ? () => {
                if (isPdf) {
                  setPreview({ url: serveUrl, name: group.title, page: 1 });
                } else {
                  window.open(serveUrl, '_blank', 'noopener');
                }
              }
            : undefined;
          // Clicking a citation badge opens the PDF at the page that chunk came
          // from. The page is resolved server-side (the chunk text is matched
          // against the document's pages), which takes a moment on a big file —
          // so open at page 1 straight away and jump once it resolves. A chunk
          // that can't be placed (an OCR'd page) simply stays on page 1.
          const openAtCitation =
            serveUrl && isPdf && att && convId
              ? (cite: { label: string; text?: string }) => {
                  setPreview({ url: serveUrl, name: group.title, page: 1 });
                  if (!cite.text) return;
                  locateAttachmentPage(convId, att.id, cite.text)
                    .then((page) => {
                      if (!page) return;
                      setPreview((prev) =>
                        prev && prev.url === serveUrl ? { ...prev, page } : prev,
                      );
                    })
                    .catch(() => {});
                }
              : undefined;
          const clickable = group.isWeb ? !!group.url : !!openFile;
          const nameNode = (
            <Text
              size="2"
              weight="medium"
              style={{
                flex: 1,
                minWidth: 0,
                color: clickable ? 'var(--accent-11)' : 'var(--slate-12)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                ...(clickable ? { cursor: 'pointer' } : null),
              }}
            >
              {displayName}
            </Text>
          );

          return (
            <Card
              key={`${displayName}-${idx}`}
              onClick={openFile}
              title={openFile ? `Open ${displayName}` : displayName}
              style={{
                backgroundColor: 'var(--slate-2)',
                borderRadius: 'var(--radius-2)',
                padding: 'var(--space-2)',
                border: '1px solid var(--slate-6)',
                ...(openFile ? { cursor: 'pointer' } : null),
              }}
            >
              <Flex gap="2" align="center">
                {/* One badge per `[N]` the answer used for this file, each
                    opening the document at that citation's page. */}
                <Flex gap="1" align="center" style={{ flexShrink: 0 }}>
                  {group.labels.map((cite) => (
                    <SourceNumberCircle
                      key={cite.label}
                      label={cite.label}
                      onClick={openAtCitation ? () => openAtCitation(cite) : undefined}
                      title={
                        openAtCitation
                          ? `Open ${displayName} where [${cite.label}] was cited`
                          : undefined
                      }
                    />
                  ))}
                </Flex>
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

      <PdfPreviewDialog
        url={preview?.url ?? null}
        filename={preview?.name ?? ''}
        initialPage={preview?.page ?? 1}
        onClose={() => setPreview(null)}
      />
    </Flex>
  );
}
