'use client';

import React, { useEffect, useState } from 'react';
import { Dialog, VisuallyHidden, Flex, Text, IconButton, Spinner } from '@radix-ui/themes';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import { cleanFilename } from '../utils/clean-filename';

interface PdfPreviewDialogProps {
  /** Serve URL of the PDF to preview, or null when the dialog is closed. */
  url: string | null;
  /** Original filename, shown in the header. */
  filename: string;
  /** Called when the dialog requests to close. */
  onClose: () => void;
}

/**
 * Modal PDF preview. Fetches the file through the same-origin proxy (so the
 * session cookie rides along) and renders it from a `blob:` URL in an iframe.
 *
 * Going through a blob — rather than pointing the iframe straight at the serve
 * route — keeps the browser's built-in PDF viewer working regardless of the
 * response's `Content-Security-Policy: sandbox`, and forcing the blob type to
 * `application/pdf` means the bytes are never interpreted as anything
 * scriptable.
 */
export function PdfPreviewDialog({ url, filename, onClose }: PdfPreviewDialogProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!url) {
      setObjectUrl(null);
      setFailed(false);
      return;
    }
    let cancelled = false;
    let created: string | null = null;
    setObjectUrl(null);
    setFailed(false);
    fetch(url, { credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        const pdf =
          blob.type === 'application/pdf'
            ? blob
            : new Blob([blob], { type: 'application/pdf' });
        created = URL.createObjectURL(pdf);
        setObjectUrl(created);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url]);

  const name = cleanFilename(filename);

  return (
    <Dialog.Root open={url !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Content
        style={{
          width: '960px',
          maxWidth: '92vw',
          height: '88vh',
          padding: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <VisuallyHidden>
          <Dialog.Title>{name}</Dialog.Title>
          <Dialog.Description>Preview of {name}.</Dialog.Description>
        </VisuallyHidden>

        {/* Header: filename + close button */}
        <Flex
          align="center"
          justify="between"
          gap="3"
          style={{
            padding: 'var(--space-3) var(--space-4)',
            borderBottom: '1px solid var(--slate-6)',
            flexShrink: 0,
          }}
        >
          <Text
            size="2"
            weight="bold"
            style={{
              color: 'var(--slate-12)',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
          </Text>
          <Dialog.Close>
            <IconButton
              variant="ghost"
              size="1"
              color="gray"
              aria-label="Close preview"
              style={{ flexShrink: 0 }}
            >
              <MaterialIcon name="close" size={18} color="var(--slate-11)" />
            </IconButton>
          </Dialog.Close>
        </Flex>

        {/* Body: spinner while loading, the PDF once ready, or an error note */}
        <Flex
          align="center"
          justify="center"
          style={{ flex: 1, minHeight: 0, backgroundColor: 'var(--slate-2)' }}
        >
          {failed ? (
            <Text size="2" style={{ color: 'var(--slate-11)' }}>
              Couldn&apos;t load this file.
            </Text>
          ) : objectUrl ? (
            <iframe
              src={objectUrl}
              title={name}
              style={{ width: '100%', height: '100%', border: 'none' }}
            />
          ) : (
            <Spinner size="3" />
          )}
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
