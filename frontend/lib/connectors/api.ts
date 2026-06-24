// ========================================
// Connector read API (builder-facing)
// ========================================
//
// Extracted from the workspace connectors admin route so the agent builder can
// list the user's connectors as available data sources without coupling to the
// (deleted) admin route tree. Only the read (list / registry) methods the
// builder needs are kept here; the admin write surface lived in the deleted
// route.

import { apiClient } from '@/lib/api';
import type { ConnectorScope, ConnectorListResponse } from './types';

const BASE_URL = '/api/v1/connectors';

export const ConnectorsApi = {
  /**
   * Fetch active (configured) connectors for a given scope.
   */
  async getActiveConnectors(
    scope: ConnectorScope,
    page = 1,
    limit = 100
  ): Promise<ConnectorListResponse> {
    const { data } = await apiClient.get<ConnectorListResponse>(BASE_URL, {
      params: { scope, page, limit },
    });
    return data;
  },

  /**
   * Fetch the full connector registry (all available connectors).
   */
  async getRegistryConnectors(
    scope: ConnectorScope,
    page = 1,
    limit = 100
  ): Promise<ConnectorListResponse> {
    const { data } = await apiClient.get<ConnectorListResponse>(
      `${BASE_URL}/registry`,
      { params: { scope, page, limit } }
    );
    return data;
  },
};
