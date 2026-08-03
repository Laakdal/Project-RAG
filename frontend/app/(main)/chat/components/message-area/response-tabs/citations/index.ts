'use client';

export { InlineCitationBadge } from './inline-citation-badge';
export { InlineCitationGroup } from './inline-citation-group';
export {
  buildCitationMapsFromApi,
  buildCitationMapsFromStreaming,
  emptyCitationMaps,
} from './utils';
export { useCitationActions } from './use-citation-actions';
export { isCitationPopoverKeyStillValid } from './citation-popover-control';
export type {
  CitationOrigin,
  CitationData,
  CitationMaps,
  CitationCallbacks,
} from './types';
