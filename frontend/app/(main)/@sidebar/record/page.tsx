'use client';

/**
 * Sidebar slot for /record — renders nothing, because the record view is a
 * full-width shell with its own chrome (see record/layout.tsx).
 *
 * A slot segment that does not match leaves the slot's previous content mounted
 * on client-side navigation (default.tsx only applies on a hard load), so
 * without this the chat sidebar followed the user into the record view.
 *
 * `/record/:recordId` URLs are rewritten to this same `/record/` shell in
 * next.config.mjs, so one segment covers the deep links too.
 */
export default function RecordSidebarSlot() {
  return null;
}
