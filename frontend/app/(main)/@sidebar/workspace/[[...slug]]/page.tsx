'use client';

/**
 * Sidebar slot for all /workspace/* (admin) routes — renders nothing so the
 * chat sidebar is removed. Without this catch-all, soft navigation from the
 * chat page keeps the previous chat sidebar (Next only falls back to
 * @sidebar/default.tsx on a hard load, not on client-side navigation). The
 * workspace layout supplies its own admin sidebar.
 */
export default function WorkspaceSidebarSlot() {
  return null;
}
