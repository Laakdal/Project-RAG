// Graph nodes degrade gracefully on error — empty docs, default routing, a
// fallback answer — so one failing step never takes down the whole query. That
// is the right behaviour, but swallowing the cause silently makes real faults
// invisible: a hard 400 from a provider looked exactly like "no documents
// found", with nothing in the container logs to tell them apart.
//
// Message only, never the error object: provider errors can carry the request
// body, and for these nodes that includes the prompt and retrieved document
// text.
export function logNodeError(node: string, error: unknown): void {
  // eslint-disable-next-line no-console
  console.error(`${node} failed:`, error instanceof Error ? error.message : String(error));
}
