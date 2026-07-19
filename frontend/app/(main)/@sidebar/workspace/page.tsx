'use client';

/**
 * Sidebar slot for /workspace — renders nothing, because the workspace shell
 * mounts its own drawer (see workspace/layout.tsx).
 *
 * A slot segment that does not match leaves the slot's previous content mounted
 * on client-side navigation (default.tsx only applies on a hard load), so
 * without this the chat sidebar followed the user into the admin panel.
 * The sibling [...rest] slot covers the nested admin routes.
 */
export default function WorkspaceSidebarSlot() {
  return null;
}
