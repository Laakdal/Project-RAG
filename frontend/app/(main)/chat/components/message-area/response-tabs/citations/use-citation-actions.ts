'use client';

import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { CitationData, CitationCallbacks, CitationOrigin } from './types';

/**
 * Hook that provides citation interaction callbacks.
 *
 * "Open in Collection" sends connector-backed citations to their original app
 * and everything else to the document library. It used to resolve the record
 * through the knowledge-base API first, but that surface is not served here, so
 * the lookup only ever threw and fell through to the same navigation.
 */
export function useCitationActions(): CitationCallbacks {
  const router = useRouter();

  const onOpenInCollection = useCallback(
    async (citation: CitationData) => {
      const origin: CitationOrigin | undefined = citation.origin;

      if (origin === 'CONNECTOR') {
        // External source — open in the original app (OneDrive, Slack, etc.)
        if (citation.webUrl) {
          window.open(citation.webUrl, '_blank', 'noopener,noreferrer');
        } else {
          console.warn('Citation has CONNECTOR origin but no webUrl:', citation.recordId);
        }
        return;
      }

      router.push('/workspace/library');
    },
    [router],
  );

  return useMemo(() => ({ onOpenInCollection }), [onOpenInCollection]);
}
