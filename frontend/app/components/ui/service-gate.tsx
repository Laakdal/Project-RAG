'use client';

import type { AppServices } from '@/lib/store/services-health-store';

type AppServiceKey = keyof AppServices;

interface ServiceGateProps {
  children: React.ReactNode;
  services: AppServiceKey[];
}

export type { AppServiceKey };

/**
 * Pass-through gate.
 *
 * The upstream template gated pages behind a `/api/v1/health/services` poll.
 * The RAG backend has no such endpoint (only `GET /health`, which isn't even
 * proxied), so the poll 404'd on every chat load. There is nothing to gate on
 * now, so this component renders its children unconditionally — it is kept
 * only so call sites (e.g. the chat page layout) don't have to change.
 */
export function ServiceGate({ children }: ServiceGateProps) {
  return <>{children}</>;
}
