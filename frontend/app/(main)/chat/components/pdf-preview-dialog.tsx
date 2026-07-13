'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Dialog, VisuallyHidden, Flex, Text, IconButton, Spinner, Theme } from '@radix-ui/themes';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import { usePdfZoom } from '@/app/components/file-preview/use-pdf-zoom';
import { PDF_ZOOM_MAX, PDF_ZOOM_MIN } from '@/app/components/file-preview/types';
import { cleanFilename } from '../utils/clean-filename';

// react-pdf-highlighter bundles pdfjs-dist which touches `document` at module
// init, so the renderer must be excluded from the server bundle with ssr:false.
const PDFRenderer = dynamic(
  () => import('@/app/components/file-preview/renderers/pdf-renderer').then((m) => m.PDFRenderer),
  { ssr: false },
);

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
 * session cookie rides along) and renders it with the app's own pdf.js-based
 * {@link PDFRenderer} — giving us an in-app viewer with our own zoom / page
 * controls instead of the browser's built-in PDF plugin chrome.
 *
 * The bytes are read into a `blob:` URL (forced to `application/pdf`) so the
 * viewer loads them regardless of the response's `Content-Security-Policy:
 * sandbox`, and are never interpreted as anything scriptable.
 */
export function PdfPreviewDialog({ url, filename, onClose }: PdfPreviewDialogProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const { pdfScale, handlePdfZoomIn, handlePdfZoomOut } = usePdfZoom(filename, objectUrl ?? '');

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
    setCurrentPage(1);
    setTotalPages(null);
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

  const canPrev = currentPage > 1;
  const canNext = totalPages !== null && currentPage < totalPages;
  const zoomPercent = Math.round(pdfScale * 100);

  const handleDownload = () => {
    if (!objectUrl) return;
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

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

        {/* Header: filename + viewer controls + close button */}
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

          <Flex align="center" gap="3" style={{ flexShrink: 0 }}>
            {objectUrl && !failed && (
              <>
                {/* Zoom */}
                <Flex align="center" gap="1">
                  <IconButton
                    variant="ghost"
                    size="1"
                    color="gray"
                    aria-label="Zoom out"
                    disabled={pdfScale <= PDF_ZOOM_MIN}
                    onClick={handlePdfZoomOut}
                  >
                    <MaterialIcon name="remove" size={18} color="var(--slate-11)" />
                  </IconButton>
                  <Text
                    size="1"
                    style={{ color: 'var(--slate-11)', minWidth: 38, textAlign: 'center' }}
                  >
                    {zoomPercent}%
                  </Text>
                  <IconButton
                    variant="ghost"
                    size="1"
                    color="gray"
                    aria-label="Zoom in"
                    disabled={pdfScale >= PDF_ZOOM_MAX}
                    onClick={handlePdfZoomIn}
                  >
                    <MaterialIcon name="add" size={18} color="var(--slate-11)" />
                  </IconButton>
                </Flex>

                {/* Page navigation */}
                <Flex align="center" gap="1">
                  <IconButton
                    variant="ghost"
                    size="1"
                    color="gray"
                    aria-label="Previous page"
                    disabled={!canPrev}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  >
                    <MaterialIcon name="chevron_left" size={18} color="var(--slate-11)" />
                  </IconButton>
                  <Text
                    size="1"
                    style={{ color: 'var(--slate-11)', minWidth: 44, textAlign: 'center' }}
                  >
                    {currentPage}
                    {totalPages !== null ? ` / ${totalPages}` : ''}
                  </Text>
                  <IconButton
                    variant="ghost"
                    size="1"
                    color="gray"
                    aria-label="Next page"
                    disabled={!canNext}
                    onClick={() =>
                      setCurrentPage((p) =>
                        totalPages !== null ? Math.min(totalPages, p + 1) : p + 1,
                      )
                    }
                  >
                    <MaterialIcon name="chevron_right" size={18} color="var(--slate-11)" />
                  </IconButton>
                </Flex>

                {/* Download */}
                <IconButton
                  variant="ghost"
                  size="1"
                  color="gray"
                  aria-label="Download"
                  onClick={handleDownload}
                >
                  <MaterialIcon name="download" size={18} color="var(--slate-11)" />
                </IconButton>
              </>
            )}

            <Dialog.Close>
              <IconButton
                variant="ghost"
                size="1"
                color="gray"
                aria-label="Close preview"
              >
                <MaterialIcon name="close" size={18} color="var(--slate-11)" />
              </IconButton>
            </Dialog.Close>
          </Flex>
        </Flex>

        {/* Body: spinner while loading, the PDF once ready, or an error note.
            Forced to dark appearance so the viewer gutter (and its text) render
            identically in light and dark mode. */}
        <Theme
          appearance="dark"
          style={{ flex: 1, minHeight: 0, display: 'flex' }}
        >
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
              <PDFRenderer
                fileUrl={objectUrl}
                fileName={name}
                pagination={{
                  currentPage,
                  totalPages,
                  scale: pdfScale,
                  onPageChange: setCurrentPage,
                  onTotalPagesDetected: setTotalPages,
                }}
              />
            ) : (
              <Spinner size="3" />
            )}
          </Flex>
        </Theme>
      </Dialog.Content>
    </Dialog.Root>
  );
}
