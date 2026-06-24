// ========================================
// User lookups (share / picker facing)
// ========================================
//
// Extracted from the workspace users admin route so chat sharing, the share
// components, team creation, and paginated user pickers can look up users
// without coupling to the (deleted) admin route tree. The underlying calls
// still hit the existing /api/v1/users endpoints; only the read methods those
// features need are kept here.

import { apiClient } from '@/lib/api';
import type {
  User,
  UserByIdsDoc,
  UsersListResponse,
  WithGroupsUser,
} from '@/lib/types/users';

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

const BASE_URL = '/api/v1/users';

export const UsersApi = {
  /**
   * List users with pagination and server-side filters.
   * GET /api/v1/users?page=&limit=&search=&hasLoggedIn=&groupIds=
   */
  async listUsers(params?: {
    page?: number;
    limit?: number;
    search?: string;
    hasLoggedIn?: string;
    isBlocked?: string;
    groupIds?: string;
  }): Promise<{ users: User[]; totalCount: number }> {
    const { data } = await apiClient.get<UsersListResponse>(BASE_URL, { params });
    return {
      users: data.users ?? [],
      totalCount: data.pagination?.totalCount ?? data.users?.length ?? 0,
    };
  },

  /**
   * Fetch users with all enrichment (groups, blocked status, profile pictures).
   * Single call to GET /api/v1/users — backend returns everything.
   */
  async fetchMergedUsers(params?: {
    page?: number;
    limit?: number;
    search?: string;
    hasLoggedIn?: string;
    isBlocked?: string;
    groupIds?: string;
  }): Promise<{ users: User[]; totalCount: number }> {
    return UsersApi.listUsers(params);
  },

  /**
   * Fetch users with their group memberships and hasLoggedIn status.
   * GET /api/v1/users/fetch/with-groups
   */
  async fetchUsersWithGroups(): Promise<WithGroupsUser[]> {
    const { data } = await apiClient.get(`${BASE_URL}/fetch/with-groups`);
    return Array.isArray(data) ? data : (data as { users: WithGroupsUser[] }).users ?? [];
  },

  /**
   * Get a single user by ID.
   * GET /api/v1/users/:id
   */
  async getUser(id: string): Promise<User> {
    const { data } = await apiClient.get<User>(`${BASE_URL}/${id}`);
    return data;
  },

  /**
   * Batch lookup users by their MongoDB IDs.
   * POST /api/v1/users/by-ids
   * Use this to enrich known user IDs with name/email without scanning
   * the whole user list.
   */
  async getUsersByIds(userIds: string[]): Promise<User[]> {
    if (userIds.length === 0) return [];
    const { data } = await apiClient.post<UserByIdsDoc[] | { users: UserByIdsDoc[] }>(
      `${BASE_URL}/by-ids`,
      { userIds }
    );
    const raw = Array.isArray(data) ? data : data.users ?? [];
    return raw.map(userFromByIdsDoc);
  },
};
