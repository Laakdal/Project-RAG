/**
 * Shared helpers for RAG retrieval sources — used by both the per-answer
 * Sources footer (`MessageSources`) and the inline-citation map builder so the
 * two surfaces classify and link sources identically.
 */

/** File extensions that mark a source as an actual document (vs a web page). */
const DOCUMENT_EXT_RE =
  /\.(pdf|docx?|pptx?|xlsx?|csv|txt|md|rtf|png|jpe?g|gif|webp|svg|bmp|tiff?|html?)$/i;

/**
 * Only http(s) links are safe to place in an `href`. Source URLs come from the
 * RAG/web-search payload, so reject `javascript:`, `data:`, etc. — anything that
 * fails this check should be treated as if there were no link at all.
 */
export function safeHttpUrl(url?: string): string | undefined {
  if (!url) return undefined;
  return /^https?:\/\//i.test(url.trim()) ? url : undefined;
}

/**
 * A source is a web-search result (not an ingested/library document) when its
 * name doesn't end in a known document extension. Web results arrive either as
 * a bare URL in the name or as a page title paired with a link, while
 * uploaded/library docs always carry a real filename with an extension.
 */
export function isWebSource(title: string, url?: string): boolean {
  const name = (title || '').trim();
  if (DOCUMENT_EXT_RE.test(name)) return false;
  return /^https?:\/\//i.test(name) || !!url;
}

/** Extension without the dot, for FileIcon (e.g. "Report.pdf" → "pdf"). */
export function fileExtensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec((name || '').trim());
  return m ? m[1].toLowerCase() : '';
}
