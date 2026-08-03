'use client';

import type {
  CitationData,
  CitationMaps,
  StreamingCitationData,
  ConnectorConfig,
  CitationOrigin,
} from './types';
import type { CitationApiResponse } from '@/chat/types';

// ---------------------------------------------------------------------------
// Connector configuration (delegates to centralized ConnectorIcon mapping)
// ---------------------------------------------------------------------------

import {
  getConnectorIconConfig,
  resolveConnectorType,
} from '@/app/components/ui/ConnectorIcon';

/** Resolve connector key → display config. */
export function getConnectorConfig(connector: string): ConnectorConfig {
  const resolved = resolveConnectorType(connector);
  const iconConfig = getConnectorIconConfig(connector);
  const isCollections =
    resolved === 'kb' || resolved === 'knowledge-base';
  const isLocalFs = resolved === 'local-fs' || resolved === 'localfs';
  let label = connector || "Source";
  if (isCollections) label = "Collections";
  if (isLocalFs) label = "Local FS";
  return {
    label,
    icon: iconConfig.svg || '/icons/connectors/GDrive.svg',
  };
}

// ---------------------------------------------------------------------------
// Build citation maps from the *complete* response (CitationApiResponse[])
// ---------------------------------------------------------------------------

export function buildCitationMapsFromApi(
  rawCitations: CitationApiResponse[]
): CitationMaps {
  const citations: Record<string, CitationData> = {};
  const sources: Record<string, string> = {};
  const sourcesOrder: string[] = [];
  const citationsOrder: Record<number, string> = {};

  for (const raw of rawCitations) {
    const citationId = raw.citationId;
    const data = raw.citationData;
    if (!data) continue;

    const metadata = data.metadata;
    if (!metadata) continue;

    const normalized: CitationData = {
      citationId,
      content: data.content,
      chunkIndex: data.chunkIndex,
      recordId: metadata.recordId,
      recordName: metadata.recordName || 'Untitled Document',
      connector: metadata.connector || '',
      recordType: metadata.recordType || '',
      webUrl: metadata.webUrl,
      mimeType: metadata.mimeType || '',
      extension: metadata.extension || '',
      pageNum: metadata.pageNum,
      blockNum: metadata.blockNum,
      previewRenderable: metadata.previewRenderable ?? false,
      hideWeburl: (metadata as Record<string, unknown>).hideWeburl as boolean ?? false,
      citationType: data.citationType || '',
      origin: (metadata as Record<string, unknown>).origin as CitationOrigin | undefined,
      boundingBox: (metadata as Record<string, unknown>).bounding_box as Array<{ x: number; y: number }> | undefined,
      updatedAt: data.updatedAt,
    };

    citations[citationId] = normalized;
    citationsOrder[data.chunkIndex] = citationId;

    if (!sources[metadata.recordId]) {
      sources[metadata.recordId] = citationId;
      sourcesOrder.push(metadata.recordId);
    }
  }

  return { citations, sources, sourcesOrder, citationsOrder };
}

// ---------------------------------------------------------------------------
// Build citation maps from *streaming* chunk citations
// ---------------------------------------------------------------------------

export function buildCitationMapsFromStreaming(
  rawCitations: StreamingCitationData[]
): CitationMaps {
  const citations: Record<string, CitationData> = {};
  const sources: Record<string, string> = {};
  const sourcesOrder: string[] = [];
  const citationsOrder: Record<number, string> = {};

  for (const raw of rawCitations) {
    const tempId = `streaming-${raw.chunkIndex}`;
    const metadata = raw.metadata;
    if (!metadata) continue;

    const normalized: CitationData = {
      citationId: tempId,
      content: raw.content,
      chunkIndex: raw.chunkIndex,
      recordId: metadata.recordId,
      recordName: metadata.recordName || 'Untitled Document',
      connector: metadata.connector || '',
      recordType: metadata.recordType || '',
      webUrl: metadata.webUrl,
      mimeType: metadata.mimeType || '',
      extension: metadata.extension || '',
      pageNum: metadata.pageNum,
      blockNum: metadata.blockNum,
      previewRenderable: metadata.previewRenderable ?? false,
      hideWeburl: metadata.hideWeburl ?? false,
      citationType: raw.citationType || '',
      origin: metadata.origin,
      boundingBox: metadata.bounding_box,
      updatedAt: undefined, // not available during streaming
    };

    citations[tempId] = normalized;
    citationsOrder[raw.chunkIndex] = tempId;

    if (!sources[metadata.recordId]) {
      sources[metadata.recordId] = tempId;
      sourcesOrder.push(metadata.recordId);
    }
  }

  return { citations, sources, sourcesOrder, citationsOrder };
}

// ---------------------------------------------------------------------------
// Empty / default maps
// ---------------------------------------------------------------------------

export function emptyCitationMaps(): CitationMaps {
  return {
    citations: {},
    sources: {},
    sourcesOrder: [],
    citationsOrder: {},
  };
}

/**
 * URL for a real `<a href>` so the browser context menu offers "Copy link" /
 * "Open in new tab" (modifier-click). Returns undefined when the backend hides
 * the URL or none is present.
 */
export function getCitationCopyHref(citation: CitationData): string | undefined {
  if (citation.hideWeburl) return undefined;
  const raw = citation.webUrl?.trim();
  return raw ? raw : undefined;
}

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

