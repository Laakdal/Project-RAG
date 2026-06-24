// ========================================
// Shared team entity types
// ========================================
//
// Extracted from the workspace teams admin route so the share sidebar's
// "create team" flow can depend on the team shape without coupling to the
// (deleted) admin route tree.

export type TeamMemberRole = 'OWNER' | 'READER' | 'WRITER';

export interface TeamCreatedByUser {
  /** Graph user key of the team creator */
  id: string;
  userId: string;
  name: string;
  email: string;
  profilePicture?: string | null;
}

export interface TeamMember {
  /** User UUID */
  id: string;
  /** MongoDB user ID */
  userId: string;
  userName: string;
  userEmail: string;
  role: TeamMemberRole | string;
  joinedAt: number;
  isOwner: boolean;
  /** Data URI for profile picture, if available */
  profilePicture?: string;
}

export interface Team {
  /** UUID primary key */
  id: string;
  name: string;
  description: string | null;
  createdByUser?: TeamCreatedByUser | null;
  orgId: string;
  createdAtTimestamp: number;
  updatedAtTimestamp: number;

  /** Array of team members */
  members: TeamMember[];
  /** Total member count */
  memberCount: number;

  /** Permission flags for the current user */
  canEdit: boolean;
  canDelete: boolean;
  canManageMembers: boolean;
}

// ========================================
// API request shapes
// ========================================

export interface CreateTeamUserRole {
  /** MongoDB ObjectId (not graph UUID) */
  userId: string;
  role: TeamMemberRole;
}

export interface CreateTeamPayload {
  name: string;
  description?: string;
  userRoles?: CreateTeamUserRole[];
}
