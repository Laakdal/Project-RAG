'use client';

/**
 * Sidebar slot for every nested admin route (/workspace/users, /workspace/library,
 * /workspace/profile, and any future deep link) — renders nothing, matching the
 * /workspace slot above it.
 *
 * A catch-all rather than one file per route so a newly added admin page cannot
 * silently reintroduce the stale-slot bug: an unmatched slot segment keeps the
 * previously rendered sidebar (the chat sidebar) mounted on soft navigation.
 */
export default function WorkspaceNestedSidebarSlot() {
  return null;
}
