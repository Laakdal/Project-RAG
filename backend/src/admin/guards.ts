// Pure access-control guards for admin user-management actions. No DB access:
// the caller fetches the needed facts (admin counts, the target's state) and
// passes them in, so these stay trivially testable and side-effect free.

/**
 * Thrown when an admin action is not allowed. Carries an HTTP status so the
 * route can translate it into a response without leaking internals.
 */
export class GuardError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GuardError";
  }
}

/** Block an admin from acting destructively on their own account. */
export function ensureNotSelf(currentUserId: string, targetUserId: string): void {
  if (currentUserId === targetUserId) {
    throw new GuardError(
      409,
      "You cannot perform this action on your own account",
    );
  }
}

/**
 * Block removing the last remaining active admin. `activeAdminCount` is the
 * number of admins with disabledAt IS NULL; `targetIsActiveAdmin` is whether
 * the target currently counts toward that total.
 */
export function ensureNotLastAdmin(
  activeAdminCount: number,
  targetIsActiveAdmin: boolean,
): void {
  if (targetIsActiveAdmin && activeAdminCount <= 1) {
    throw new GuardError(409, "There must be at least one active admin");
  }
}
