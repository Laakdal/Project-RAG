// All Records Transformation Utilities

import type {
  KnowledgeHubNode,
  ConnectorType,
  AllRecordsSidebarSelection,
  AllRecordsFilter,
  AllRecordsSortConfig,
  AllRecordsPagination,
  KnowledgeHubQueryParams,
  AppNodeGroup,
} from '../types';
import { resolveConnectorType } from '@/app/components/ui/ConnectorIcon';
import { KB_MIN_SEARCH_QUERY_LENGTH } from '../utils';

/**
 * Connector group for sidebar display
 */
export interface ConnectorGroup {
  type: ConnectorType;
  name: string;
  icon: string;
  items: KnowledgeHubNode[];
}

/**
 * Map API connector string to ConnectorType (delegates to centralized resolver)
 */
export function mapConnectorType(connectorString: string): ConnectorType {
  return resolveConnectorType(connectorString);
}

/** Hub app for org Collections (KB) — `connector` / `subType` casing may vary from the API. */
export function isKbCollectionsHubApp(node: { connector?: string; subType?: string }): boolean {
  const c = (node.connector ?? '').toString().trim().toUpperCase();
  if (c === 'KB') return true;
  return (node.subType ?? '').toString().trim().toUpperCase() === 'KB';
}

/**
 * Get display name for connector
 */
function getConnectorDisplayName(connectorString: string): string {
  return connectorString;
}


/**
 * Get source display info from node
 */
export function getSourceDisplay(
  node: KnowledgeHubNode,
  kbLookup: Map<string, string>
): { sourceName: string; sourceType: 'collection' | ConnectorType; sourceIcon: string } {
  if (node.origin === 'COLLECTION' || isKbCollectionsHubApp(node)) {
    // For KB items, extract KB name from webUrl or use lookup
    const kbId = extractKbIdFromNode(node);
    const kbName = kbId ? kbLookup.get(kbId) || 'Collection' : 'Collection';

    return {
      sourceName: kbName,
      sourceType: 'collection',
      sourceIcon: 'folder',
    };
  }

  // For connector items, use the connector field
  const connectorType = node.connector ? mapConnectorType(node.connector) : 'google-drive';
  const sourceName = node.connector || 'Connector';

  return {
    sourceName,
    sourceType: connectorType,
    sourceIcon: connectorType,
  };
}

/**
 * Extract KB ID from node webUrl
 * webUrl format: "/kb/{kbId}" or "/kb/{kbId}/folder/{folderId}"
 */
function extractKbIdFromNode(node: KnowledgeHubNode): string | null {
  if (!node.webUrl) return null;

  const match = node.webUrl.match(/\/kb\/([^/]+)/);
  return match ? match[1] : null;
}


/**
 * Build KB lookup map from flat collections
 */
export function buildKbLookup(flatCollections: Array<{ id: string; name: string; nodeType: string }>): Map<string, string> {
  const lookup = new Map<string, string>();

  flatCollections.forEach((node) => {
    if (node.nodeType === 'kb') {
      lookup.set(node.id, node.name);
    }
  });

  return lookup;
}

/**
 * Filter items by size range (client-side)
 */
function filterBySize(items: KnowledgeHubNode[], sizeRanges?: string[]): KnowledgeHubNode[] {
  if (!sizeRanges || sizeRanges.length === 0) return items;

  return items.filter((item) => {
    if (item.sizeInBytes === null || item.sizeInBytes === undefined) return false;

    const sizeInBytes = item.sizeInBytes;

    return sizeRanges.some((range) => {
      switch (range) {
        case 'lt1mb':
          return sizeInBytes < 1024 * 1024;
        case '1to10mb':
          return sizeInBytes >= 1024 * 1024 && sizeInBytes < 10 * 1024 * 1024;
        case '10to100mb':
          return sizeInBytes >= 10 * 1024 * 1024 && sizeInBytes < 100 * 1024 * 1024;
        default:
          return false;
      }
    });
  });
}

/**
 * Apply client-side filters (size only — date filters are handled server-side)
 */
export function applyClientSideFilters(
  items: KnowledgeHubNode[],
  filter: AllRecordsFilter
): KnowledgeHubNode[] {
  let filtered = items;

  // Size filter
  if (filter.sizeRanges && filter.sizeRanges.length > 0) {
    filtered = filterBySize(filtered, filter.sizeRanges);
  }

  return filtered;
}
