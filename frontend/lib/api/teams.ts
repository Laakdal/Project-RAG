// ========================================
// Team creation (share-facing)
// ========================================
//
// Extracted from the workspace teams admin route so the share sidebar's
// "create team" flow can create a team without coupling to the (deleted) admin
// route tree. Only the create method that surviving feature needs is kept here;
// the admin management surface lived in the deleted route.

import { apiClient } from '@/lib/api';
import type { Team, CreateTeamPayload } from '@/lib/types/teams';

const BASE_URL = '/api/v1/teams';

export const TeamsApi = {
  /**
   * Create a new team.
   * POST /api/v1/teams
   * Body: { name, description?, userRoles?: [{ userId (UUID), role }] }
   */
  async createTeam(payload: CreateTeamPayload): Promise<Team> {
    const { data } = await apiClient.post<{ team: Team } | Team>(BASE_URL, payload);
    if (data && typeof data === 'object' && 'team' in data) {
      return (data as { team: Team }).team;
    }
    return data as Team;
  },
};
