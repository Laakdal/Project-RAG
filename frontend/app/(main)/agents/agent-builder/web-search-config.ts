// ============================================================
// Web Search config — folded into the agent builder.
//
// The standalone workspace web-search admin route was removed as part of the
// admin-route purge. The agent builder still has a live web-search feature
// (drag a configured provider onto the canvas; reconstruct/serialize it as an
// agent attachment), so the provider types, display metadata, and the
// read-only config lookup it depends on live here now.
//
// Provider API keys are still configured workspace-wide on the backend
// (`/api/v1/configurationManager/web-search`); only the admin UI for editing
// them was removed. `getConfig()` below is read-only — it lists which
// providers a workspace already has configured so they can be attached to an
// agent.
// ============================================================

import { apiClient } from '@/lib/api';

// ── Provider identifiers ─────────────────────────────────────

export type WebSearchProviderType = 'duckduckgo' | 'serper' | 'tavily' | 'exa';

export const DUCKDUCKGO_PROVIDER_ID: WebSearchProviderType = 'duckduckgo';

/** Providers that require an API key (and previously had an admin config UI). */
export type ConfigurableProvider = Extract<WebSearchProviderType, 'serper' | 'tavily' | 'exa'>;

// ── API response shapes ──────────────────────────────────────

export interface ConfiguredWebSearchProvider {
  providerKey: string;
  provider: string;
  configuration: Record<string, string>;
  isDefault: boolean;
}

export interface WebSearchConfigData {
  providers: ConfiguredWebSearchProvider[];
}

// ── Per-provider display metadata (builder palette) ──────────

export interface WebSearchProviderMeta {
  type: WebSearchProviderType;
  label: string;
  description: string;
  icon: string;
  iconType: 'material' | 'image';
  configurable: boolean;
  docUrl: string;
  apiKeyHelperText?: string;
  apiKeyPlaceholder?: string;
}

export const WEB_SEARCH_PROVIDER_META: WebSearchProviderMeta[] = [
  {
    type: 'duckduckgo',
    label: 'DuckDuckGo',
    description: 'Built-in, no configuration required',
    icon: '/icons/web-search/duckduckgo.svg',
    iconType: 'image',
    configurable: false,
    docUrl: 'https://duckduckgo.com/about',
  },
  {
    type: 'serper',
    label: 'Serper',
    description: 'Fast Google Search API with generous free tier',
    icon: '/icons/web-search/serper.svg',
    iconType: 'image',
    configurable: true,
    docUrl: 'https://serper.dev/docs',
    apiKeyHelperText: 'Get your API key from https://serper.dev',
    apiKeyPlaceholder: 'Enter your Serper API key',
  },
  {
    type: 'tavily',
    label: 'Tavily',
    description: 'AI-optimised search API',
    icon: '/icons/web-search/tavily.svg',
    iconType: 'image',
    configurable: true,
    docUrl: 'https://docs.tavily.com',
    apiKeyHelperText: 'Get your API key from https://tavily.com',
    apiKeyPlaceholder: 'Enter your Tavily API key',
  },
  {
    type: 'exa',
    label: 'Exa',
    description: 'Neural web search API',
    icon: '/icons/web-search/exa.svg',
    iconType: 'image',
    configurable: true,
    docUrl: 'https://docs.exa.ai',
    apiKeyHelperText: 'Get your API key from https://dashboard.exa.ai/api-keys',
    apiKeyPlaceholder: 'Enter your Exa API key',
  },
];

export const ALL_WEB_SEARCH_PROVIDER_TYPES: WebSearchProviderType[] = [
  'duckduckgo',
  'serper',
  'tavily',
  'exa',
];

// ── Read-only config lookup ──────────────────────────────────

const BASE_URL = '/api/v1/configurationManager/web-search';

/**
 * Read-only web-search API used by the agent builder. Only `getConfig` is
 * retained — the admin mutations (add/update/delete provider, settings,
 * set-default) lived in the removed workspace admin route.
 */
export const WebSearchApi = {
  async getConfig(): Promise<WebSearchConfigData> {
    try {
      const { data } = await apiClient.get(BASE_URL);
      if (data.status === 'success') {
        const providers: ConfiguredWebSearchProvider[] = Array.isArray(data.providers)
          ? data.providers.map(
              (provider: {
                providerKey: string;
                provider: string;
                configuration?: Record<string, unknown>;
                isDefault?: boolean;
              }) => ({
                providerKey: provider.providerKey,
                provider: provider.provider,
                configuration: provider.configuration || {},
                isDefault: provider.isDefault || false,
              }),
            )
          : [];
        return { providers };
      }
      return { providers: [] };
    } catch {
      return { providers: [] };
    }
  },
};
