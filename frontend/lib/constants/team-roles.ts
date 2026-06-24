// ========================================
// Team role labels
// ========================================
//
// Extracted from the workspace teams admin route so the share sidebar's
// "create team" flow can label member roles without coupling to the (deleted)
// admin route tree.

import type { TeamMemberRole } from '@/lib/types/teams';

export const TEAM_ROLE_LABELS: Record<
  TeamMemberRole,
  { label: string; description: string }
> = {
  OWNER: { label: 'Owner', description: 'Full control over the team and its resources' },
  WRITER: { label: 'Writer', description: 'Can view and edit team resources' },
  READER: { label: 'Reader', description: 'Can view team resources' },
};
