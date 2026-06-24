// ========================================
// Shared user-group types
// ========================================
//
// Extracted from the workspace admin routes so the profile modal (and any
// other long-lived feature) can depend on these without coupling to the
// admin route tree.

/** Group kinds returned by the userGroups API (string-valued enum). */
export enum GroupType {
  ADMIN = 'admin',
  EVERYONE = 'everyone',
  STANDARD = 'standard',
  CUSTOM = 'custom',
}

/**
 * A system-managed group is anything that is not a user-created `custom`
 * group. System groups cannot be deleted.
 */
export function isSystemGroup(group: { type: GroupType | string }): boolean {
  return group.type !== GroupType.CUSTOM;
}

/**
 * System groups whose names are fixed and cannot be renamed
 * (the admin and everyone groups).
 */
export function hasLockedGroupName(group: { type: GroupType | string }): boolean {
  return group.type === GroupType.ADMIN || group.type === GroupType.EVERYONE;
}
