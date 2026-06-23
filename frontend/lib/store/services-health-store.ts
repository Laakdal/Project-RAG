'use client';

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

// ========================================
// Types
// ========================================

export type ServiceStatus = 'healthy' | 'unhealthy' | 'unknown';

export type InfraServices = Record<string, ServiceStatus>;

export interface AppServices {
  query: ServiceStatus;
  connector: ServiceStatus;
  indexing: ServiceStatus;
  docling: ServiceStatus;
}

interface ServicesHealthState {
  loading: boolean;
  healthy: boolean | null;
  backgroundCheckFailed: boolean;
  apiServerReachable: boolean;
  infraServices: InfraServices | null;
  appServices: AppServices | null;
  infraServiceNames: Record<string, string> | null;
  lastChecked: number | null;
}

interface ServicesHealthActions {
  checkHealth: () => Promise<void>;
  retryServerConnection: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
  startBackgroundPolling: () => void;
  stopBackgroundPolling: () => void;
  clearCache: () => void;
}

type ServicesHealthStore = ServicesHealthState & ServicesHealthActions;

// ========================================
// Constants
// ========================================

const CACHE_KEY = 'healthCheck';

// ========================================
// Store
// ========================================
//
// The upstream template polled `/api/v1/health` + `/api/v1/health/services`
// on a timer to gate pages behind backend service health. The RAG backend has
// no such endpoints (only `GET /health`, which isn't proxied), so every poll
// 404'd on the chat page. The poll is removed: services are treated as
// reachable/available, so `ServiceGate` renders its children and the chat page
// logs errors normally. The state shape, selectors, and helpers are kept so
// the admin `workspace/services` page (which fetches health itself) still
// compiles.

const initialState: ServicesHealthState = {
  loading: false,
  healthy: true,
  backgroundCheckFailed: false,
  apiServerReachable: true,
  infraServices: null,
  appServices: null,
  infraServiceNames: null,
  lastChecked: null,
};

export const useServicesHealthStore = create<ServicesHealthStore>()(
  devtools(
    immer(() => ({
      ...initialState,

      // No-ops: there is no health endpoint to poll on the RAG backend.
      checkHealth: async () => {},
      retryServerConnection: async () => {},
      startPolling: () => {},
      stopPolling: () => {},
      startBackgroundPolling: () => {},
      stopBackgroundPolling: () => {},

      clearCache: () => {
        try {
          localStorage.removeItem(CACHE_KEY);
        } catch {}
      },
    })),
    { name: 'ServicesHealthStore' },
  ),
);

// ========================================
// Constants (shared by HealthGate + ServiceGate)
// ========================================

export const APP_SERVICE_LABELS: Record<string, string> = {
  query: 'Query Service',
  connector: 'Connector Service',
  indexing: 'Indexing Service',
  docling: 'Docling Service',
};

export function formatServiceList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// ========================================
// Selectors
// ========================================

export const selectHealthy = (s: ServicesHealthStore) => s.healthy;
export const selectLoading = (s: ServicesHealthStore) => s.loading;
export const selectBackgroundCheckFailed = (s: ServicesHealthStore) => s.backgroundCheckFailed;
export const selectApiServerReachable = (s: ServicesHealthStore) => s.apiServerReachable;
export const selectInfraServices = (s: ServicesHealthStore) => s.infraServices;
export const selectAppServices = (s: ServicesHealthStore) => s.appServices;
export const selectInfraServiceNames = (s: ServicesHealthStore) => s.infraServiceNames;
export const selectLastChecked = (s: ServicesHealthStore) => s.lastChecked;

/**
 * Returns true if cached health check exists in localStorage.
 */
export function isCachedHealthy(): boolean {
  try {
    return localStorage.getItem(CACHE_KEY) === 'true';
  } catch {
    return false;
  }
}
