// ========================================
// User-group lookups (profile-facing)
// ========================================
//
// Extracted from the workspace admin routes so the profile modal can resolve a
// user's groups without coupling to the admin route tree. The underlying calls
// still hit the existing /api/v1/users endpoints.

import { apiClient } from '@/lib/api';

const BASE_URL = '/api/v1/users';

// ── Local types (kept self-contained so this file does not depend on the
//    admin route tree's type modules) ─────────────────────────────────────

/** Single user from GET /api/v1/users/fetch/with-groups */
interface WithGroupsUser {
  _id: string;
  orgId: string;
  fullName?: string;
  hasLoggedIn: boolean;
  groups: Array<{ name: string; type: string }>;
}

/**
 * One document from POST /api/v1/users/by-ids (raw `users` collection / Mongoose JSON).
 * Uses mongo `_id` and `fullName`.
 */
interface UserByIdsDoc {
  _id: string | { toString(): string };
  fullName?: string;
  email?: string;
  hasLoggedIn?: boolean;
  /** Base64 data URI from POST /by-ids profile-picture enrichment */
  profilePicture?: string;
}

/** Shared user shape used across the app for display lookups. */
interface User {
  id: string;
  userId: string;
  name?: string;
  email?: string;
  hasLoggedIn: boolean;
  isActive: boolean;
  profilePicture?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function mongoIdToString(id: UserByIdsDoc['_id']): string {
  return typeof id === 'string' ? id : id.toString();
}

/** Maps POST /by-ids payload into the shared {@link User} shape used across the app. */
function userFromByIdsDoc(doc: UserByIdsDoc): User {
  const userId = mongoIdToString(doc._id);
  return {
    id: userId,
    userId,
    name: doc.fullName,
    email: doc.email,
    hasLoggedIn: doc.hasLoggedIn ?? false,
    // Not merged with block list here; treat as active org member for display lookups.
    isActive: true,
    profilePicture: doc.profilePicture,
  };
}

/**
 * Fetch users with their group memberships and hasLoggedIn status.
 * GET /api/v1/users/fetch/with-groups
 */
async function fetchUsersWithGroups(): Promise<WithGroupsUser[]> {
  const { data } = await apiClient.get(`${BASE_URL}/fetch/with-groups`);
  return Array.isArray(data)
    ? data
    : (data as { users: WithGroupsUser[] }).users ?? [];
}

/**
 * Get all groups for a specific user by their MongoDB _id.
 * Calls the fetch/with-groups endpoint (same source used when building the Users table).
 * Returns the raw groups array — callers decide which group types to display or use for
 * role derivation.
 *
 * TODO: Replace with a dedicated GET /api/v1/users/{userId}/groups endpoint once available.
 * Current implementation downloads all users to find one — O(n) on network payload.
 */
export async function getUserGroupsForProfile(
  mongoId: string
): Promise<Array<{ name: string; type: string }>> {
  const users = await fetchUsersWithGroups();
  const user = users.find((u) => u._id === mongoId);
  return user?.groups ?? [];
}

export { mongoIdToString, userFromByIdsDoc };
