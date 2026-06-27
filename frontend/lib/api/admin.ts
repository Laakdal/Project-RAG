import { apiClient } from '@/lib/api';

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
  /** ISO timestamp when disabled, or null when active. */
  disabledAt: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  conversationCount: number;
}

export interface AdminStats {
  users: number;
  admins: number;
  disabledUsers: number;
  conversations: number;
  messages: number;
  attachments: number;
  ingestionFailures: number;
}

export interface CreateUserPayload {
  email: string;
  name?: string;
  password: string;
  isAdmin: boolean;
}

export const AdminApi = {
  /** GET /admin/users */
  async listUsers(): Promise<AdminUser[]> {
    const { data } = await apiClient.get<AdminUser[]>('/admin/users', { suppressErrorToast: true });
    return data;
  },

  /** GET /admin/stats */
  async stats(): Promise<AdminStats> {
    const { data } = await apiClient.get<AdminStats>('/admin/stats', { suppressErrorToast: true });
    return data;
  },

  /** POST /admin/users */
  async createUser(payload: CreateUserPayload): Promise<Omit<AdminUser, 'conversationCount'>> {
    const { data } = await apiClient.post<Omit<AdminUser, 'conversationCount'>>('/admin/users', payload, { suppressErrorToast: true });
    return data;
  },

  /** PATCH /admin/users/:id/admin */
  async setAdmin(id: string, isAdmin: boolean): Promise<void> {
    await apiClient.patch(`/admin/users/${id}/admin`, { isAdmin }, { suppressErrorToast: true });
  },

  /** PATCH /admin/users/:id/disabled */
  async setDisabled(id: string, disabled: boolean): Promise<void> {
    await apiClient.patch(`/admin/users/${id}/disabled`, { disabled }, { suppressErrorToast: true });
  },

  /** POST /admin/users/:id/password */
  async resetPassword(id: string, newPassword: string): Promise<void> {
    await apiClient.post(`/admin/users/${id}/password`, { newPassword }, { suppressErrorToast: true });
  },

  /** DELETE /admin/users/:id */
  async deleteUser(id: string): Promise<void> {
    await apiClient.delete(`/admin/users/${id}`, { suppressErrorToast: true });
  },
};

export default AdminApi;
