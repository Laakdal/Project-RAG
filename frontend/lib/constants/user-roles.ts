// ========================================
// User roles + role option definitions
// ========================================
//
// Extracted from the workspace admin routes so the profile modal (and any
// other long-lived feature) can depend on these without coupling to the
// admin route tree.

/**
 * Role labels shown in the UI and used when comparing / setting roles.
 * Role is derived server-side from group membership (admin group → Admin).
 */
export const USER_ROLES = {
  ADMIN: 'Admin',
  MEMBER: 'Member',
  GUEST: 'Guest',
} as const;

export type UserRoleValue = (typeof USER_ROLES)[keyof typeof USER_ROLES];

// ── Role option definitions (shared across components) ───────────

/**
 * Shape shared by SelectDropdown (invite sidebar) and SubMenuRadioOption
 * (row action role picker). Both use { value, label, description }.
 */
export interface RoleOptionDef {
  value: UserRoleValue;
  label: string;
  description: string;
}

/**
 * All available roles with their descriptions.
 * Used by the "Change Role" row action popover.
 *
 * NOTE: labels and descriptions here are static defaults.
 * Components using i18n should map over these and override
 * label / description with translated strings.
 */
export const ALL_ROLE_OPTIONS: RoleOptionDef[] = [
  {
    value: USER_ROLES.ADMIN,
    label: 'Admin',
    description: 'Access everything and perform all the actions in the workspace',
  },
  {
    value: USER_ROLES.MEMBER,
    label: 'Member',
    description: 'Access everything and perform all actions except administrative',
  },
  {
    value: USER_ROLES.GUEST,
    label: 'Guest',
    description: 'Can only view data',
  },
];

/**
 * Roles offered when inviting a new user (no Guest).
 * Used by the Invite User sidebar's "Assign Role" dropdown.
 */
export const INVITE_ROLE_OPTIONS: RoleOptionDef[] = ALL_ROLE_OPTIONS.filter(
  (r) => r.value !== USER_ROLES.GUEST
);
