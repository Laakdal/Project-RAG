import type { MoreConnectorLink } from './types';

/**
 * Page size for knowledge hub sidebar: root app list, per-app children, and
 * user-initiated `load more` fetches. Tuned to balance first-paint payload vs.
 * how often users need “Load more” (bulk refresh uses a larger limit separately).
 */
export const SIDEBAR_PAGINATION_PAGE_SIZE = 20;

// Curated "More Connectors" links for the All Records sidebar.
// Top 5 enterprise connectors per scope, based on industry adoption.

export const ADMIN_MORE_CONNECTORS: MoreConnectorLink[] = [
  { id: 'jira-link', name: 'Jira', type: 'jira', connectorTypeParam: 'Jira' },
  { id: 'confluence-link', name: 'Confluence', type: 'confluence', connectorTypeParam: 'Confluence' },
  { id: 'sharepoint-link', name: 'SharePoint', type: 'sharepoint', connectorTypeParam: 'SharePoint Online' },
  { id: 'drive-workspace-link', name: 'Google Drive', type: 'google-drive', connectorTypeParam: 'Drive Workspace' },
  { id: 'notion-link', name: 'Notion', type: 'notion', connectorTypeParam: 'Notion' },
];

export const PERSONAL_MORE_CONNECTORS: MoreConnectorLink[] = [
  { id: 'drive-link', name: 'Drive', type: 'google-drive', connectorTypeParam: 'Drive' },
  { id: 'gmail-link', name: 'Gmail', type: 'gmail', connectorTypeParam: 'Gmail' },
  { id: 'outlook-personal-link', name: 'Outlook Personal', type: 'outlook', connectorTypeParam: 'Outlook Personal' },
  { id: 'dropbox-personal-link', name: 'Dropbox Personal', type: 'dropbox', connectorTypeParam: 'Dropbox Personal' },
  { id: 'nextcloud-link', name: 'Nextcloud', type: 'nextcloud', connectorTypeParam: 'Nextcloud' },
];

/** Reindex only the selected node (no descendants). */
export const REINDEX_SELF_DEPTH = 0;

/** Reindex node and descendants (sidebar / container bulk actions). */
export const FOLDER_REINDEX_DEPTH = 100;
