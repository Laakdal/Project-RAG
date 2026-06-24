import { UsersApi } from '@/lib/api/users';
import type { User } from '@/lib/types/users';
import type { ShareUser } from './types';

/** Map merged Mongo users to ShareUser with Mongo `userId` as `id`. */
export function toShareUsers(users?: User[]): ShareUser[] {
  return (users ?? []).map((u) => ({
    id: u.userId,
    name: u.name ?? u.email ?? '',
    email: u.email,
    avatarUrl: u.profilePicture,
    isInOrg: true,
  }));
}

export interface ShareUsersPaginatedParams {
  page: number;
  limit: number;
  search?: string;
}

/** Paginated org user list via GET /api/v1/users (Mongo-backed). */
export async function fetchShareUsersPaginated(
  params: ShareUsersPaginatedParams
): Promise<{ users: ShareUser[]; totalCount: number }> {
  const result = await UsersApi.fetchMergedUsers({
    page: params.page,
    limit: params.limit,
    search: params.search,
  });
  return {
    users: toShareUsers(result.users),
    totalCount: result.totalCount,
  };
}
