// In-memory pub/sub for streaming pipeline progress to an open SSE request.
//
// The chat query is orchestrated by n8n, which cannot stream: it returns one
// buffered webhook response. To surface REAL per-step progress ("searching the
// web…", "writing the answer…") we correlate an SSE request and n8n's own step
// events by a random `jobId`:
//   - the SSE handler subscribes to its jobId before calling n8n;
//   - n8n POSTs step events to /internal/progress as it runs each stage;
//   - the internal route publishes them here, and the SSE handler relays them.
//
// This is intentionally process-local: it only works because the backend runs as
// a single instance (one rag_backend container). If it is ever scaled to
// multiple workers, n8n's event could land on a different worker than the one
// holding the SSE connection, and this would need a shared bus (e.g. Redis).

export type ProgressEvent = {
  /** Short machine-ish phase key (e.g. "web_search"), for optional client logic. */
  status: string;
  /** Human-readable status line shown in the UI. */
  message: string;
};

type Listener = (event: ProgressEvent) => void;

const listeners = new Map<string, Set<Listener>>();

/**
 * Subscribe to progress events for a jobId. Returns an unsubscribe function that
 * MUST be called when the SSE request ends (completion, error, or disconnect) so
 * the map does not leak.
 */
export function subscribeProgress(jobId: string, listener: Listener): () => void {
  let set = listeners.get(jobId);
  if (!set) {
    set = new Set();
    listeners.set(jobId, set);
  }
  set.add(listener);
  return () => {
    const current = listeners.get(jobId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(jobId);
  };
}

/**
 * Publish a progress event to every subscriber of a jobId. No-op when nobody is
 * listening (e.g. the client already disconnected, or a stray/late n8n event) —
 * a listener throwing never affects the others or the caller.
 */
export function publishProgress(jobId: string, event: ProgressEvent): void {
  const set = listeners.get(jobId);
  if (!set) return;
  for (const listener of set) {
    try {
      listener(event);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[progress] listener failed", err);
    }
  }
}
