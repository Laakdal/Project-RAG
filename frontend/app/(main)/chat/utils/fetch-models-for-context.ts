import { useChatStore } from '@/chat/store';
import { ChatApi } from '@/chat/api';
import type { AvailableLlmModel, ModelOverride } from '@/chat/types';

/**
 * Freshness window: within this many milliseconds the cached model list is
 * considered up-to-date and won't be refetched unless `force: true`.
 */
const FRESHNESS_MS = 60_000;

/** In-flight fetch dedupe: one concurrent request per context key at a time. */
const inflight = new Map<string, Promise<AvailableLlmModel[]>>();

function toOverride(m: AvailableLlmModel): ModelOverride {
  return {
    modelKey: m.modelKey,
    modelName: m.modelName,
    modelFriendlyName: m.modelFriendlyName || m.modelName,
    modelProvider: m.provider,
  };
}

/** Clear toolbar selection when it no longer exists in `models` (falls back to default). */
function clearSelectedModelIfNotInList(
  ctxKey: string,
  models: AvailableLlmModel[],
): void {
  const s = useChatStore.getState();
  const current = s.settings.selectedModels[ctxKey];
  if (!current) {
    return;
  }
  const stillValid = models.some(
    (m) => m.modelKey === current.modelKey && m.modelName === current.modelName,
  );
  if (!stillValid) {
    s.setSelectedModelForCtx(ctxKey, null);
  }
}

export interface FetchModelsOptions {
  /** Bypass the freshness window and the in-flight dedupe, forcing a refetch. */
  force?: boolean;
}

/**
 * Fetch, cache, and normalize the model list for a given chat context.
 *
 * Models come from the org LLM endpoint (`ChatApi.fetchAvailableLlms`).
 *
 * Side effects on the chat store:
 *   - Writes the list into `settings.availableModels[ctxKey]`
 *   - Writes the API default into `settings.defaultModels[ctxKey]`
 *   - If the user's `settings.selectedModels[ctxKey]` no longer exists in the
 *     cached or freshly fetched list, it is cleared (falls back to default).
 *     Re-validation also runs on cache hits so hydration from conversation
 *     cannot leave a removed model selected.
 *
 * Fetches for the same ctxKey are deduped and reused while in flight, and the
 * cached result is reused for `FRESHNESS_MS` afterwards.
 */
export async function fetchModelsForContext(
  ctxKey: string,
  opts: FetchModelsOptions = {},
): Promise<AvailableLlmModel[]> {
  const store = useChatStore.getState();
  const cached = store.settings.availableModels[ctxKey];

  if (!opts.force && cached && Date.now() - cached.fetchedAt < FRESHNESS_MS) {
    clearSelectedModelIfNotInList(ctxKey, cached.models);
    return cached.models;
  }

  // In-flight dedupe always applies — even `force: true` should share an
  // already-running fetch rather than starting a second identical request.
  // `force` only bypasses the freshness window, not concurrency control.
  if (inflight.has(ctxKey)) {
    return inflight.get(ctxKey)!;
  }

  const promise = (async (): Promise<AvailableLlmModel[]> => {
    const models: AvailableLlmModel[] = await ChatApi.fetchAvailableLlms();

    const s = useChatStore.getState();
    s.setAvailableModelsForCtx(ctxKey, models);

    // Prefer an explicitly flagged default; otherwise fall back to the first
    // model in the list, so the pill always shows a concrete model name
    // rather than the "AI models" placeholder.
    const def = models.find((m) => m.isDefault) ?? models[0] ?? null;
    s.setDefaultModelForCtx(ctxKey, def ? toOverride(def) : null);

    // Invalidate a stale user selection that's no longer in the list for
    // this context (e.g. admin removed the model, or the context was never
    // compatible to begin with — pill falls back to the default).
    clearSelectedModelIfNotInList(ctxKey, models);

    return models;
  })();

  inflight.set(ctxKey, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(ctxKey);
  }
}

/**
 * Drop the cached model list for `ctxKey` so the next `fetchModelsForContext`
 * call refetches from the network. Also cancels any in-flight dedupe entry
 * so a concurrent request won't return stale results.
 *
 * Call this whenever the source of truth for a context's models changes.
 */
export function invalidateModelsForContext(ctxKey: string): void {
  const store = useChatStore.getState();
  const { availableModels } = store.settings;
  if (ctxKey in availableModels) {
    const next = { ...availableModels };
    delete next[ctxKey];
    useChatStore.setState({
      settings: { ...store.settings, availableModels: next },
    });
  }
  inflight.delete(ctxKey);
}

