// ========================================
// Shared user entity types
// ========================================
//
// Extracted from the workspace users admin route so chat sharing, the share
// components, team creation, and paginated user pickers can depend on the user
// shape without coupling to the (deleted) admin route tree.

export interface User {
  /** UUID identifier (from graph API, or MongoDB _id as fallback) */
  id: string;
  /** MongoDB ObjectID */
  userId: string;
  /** Display name (may be absent for invited users) */
  name?: string;
  /** Email address (from graph API, may be absent) */
  email?: string;
  /** Whether the user has ever logged in (from with-groups API) */
  hasLoggedIn: boolean;
  /** Whether the user is currently active */
  isActive: boolean;
  /** Unix timestamp in milliseconds (absent for pending users) */
  createdAtTimestamp?: number;
  /** Unix timestamp in milliseconds (absent for pending users) */
  updatedAtTimestamp?: number;

  // ── Derived fields (computed during API merge) ──

  /** Role derived from group membership: "Admin" or "Member" */
  role?: string;
  /** Number of groups the user belongs to (excluding "everyone") */
  groupCount?: number;
  /** Data URI for profile picture, if available */
  profilePicture?: string;
  /** Inline groups from with-groups API */
  userGroups?: Array<{ _id?: string; name: string; type: string }>;

  /** Account blocked (credentials); from GET /api/v1/users?isBlocked=true merge */
  isBlocked?: boolean;
}

/**
 * One document from POST /api/v1/users/by-ids (raw `users` collection / Mongoose JSON).
 * Differs from {@link User}: mongo `_id` and `fullName` instead of `userId` / `name`.
 */
export interface UserByIdsDoc {
  _id: string | { toString(): string };
  fullName?: string;
  email?: string;
  hasLoggedIn?: boolean;
  /** Base64 data URI from POST /by-ids profile-picture enrichment */
  profilePicture?: string;
}

/** Single user from GET /api/v1/users/fetch/with-groups */
export interface WithGroupsUser {
  _id: string;
  orgId: string;
  fullName?: string;
  hasLoggedIn: boolean;
  groups: Array<{ name: string; type: string }>;
}

/** Pagination from MongoDB-backed endpoints (GET /api/v1/users) */
export interface UsersPagination {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

/** Response from GET /api/v1/users (MongoDB) */
export interface UsersListResponse {
  status: string;
  message: string;
  users: User[];
  pagination: UsersPagination;
}
