'use client';

export interface OpenRecordSourceInput {
  recordId: string;
  connector?: string;
  origin?: string;
  webUrl?: string;
  hideWeburl?: boolean;
}

export interface OpenRecordSourceDeps {
  openWindow?: (url: string) => void;
}

export type OpenRecordSourceResult =
  | { opened: 'web'; url: string }
  | { opened: 'none'; error: string };

/**
 * Open the original source behind a citation.
 *
 * Citations carry a web URL or nothing at all: the live RAG path tags every
 * source as `'WEB'` or `''` (see `message-list.tsx`), so there is no local
 * filesystem source to hand off to a desktop shell and no internal record
 * route to fall back to.
 */
export async function openRecordSource(
  input: OpenRecordSourceInput,
  deps: OpenRecordSourceDeps = {},
): Promise<OpenRecordSourceResult> {
  if (input.webUrl && !input.hideWeburl) {
    const open = deps.openWindow ?? ((target: string) => window.open(target, '_blank', 'noopener,noreferrer'));
    open(input.webUrl);
    return { opened: 'web', url: input.webUrl };
  }
  return { opened: 'none', error: 'Source URL is unavailable.' };
}
