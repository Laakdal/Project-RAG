import { apiClient } from '@/lib/api';

export interface ApiConnection {
  id: string;
  name: string;
  platform: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  createdAt: string;
}

export interface RoleDef {
  role: string;
  label: string;
  note?: string;
}

export interface Platform {
  key: string;
  label: string;
  baseUrl: string;
}

export interface ConnectionsData {
  connections: ApiConnection[];
  roles: Record<string, string | null>;
  platforms: Platform[];
  roleDefs: RoleDef[];
}

export interface ConnectionInput {
  name: string;
  platform: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export const ConnectionsApi = {
  async get(): Promise<ConnectionsData> {
    const { data } = await apiClient.get<ConnectionsData>('/admin/connections', { suppressErrorToast: true });
    return data;
  },
  async create(input: ConnectionInput): Promise<ConnectionsData> {
    const { data } = await apiClient.post<ConnectionsData>('/admin/connections', input, { suppressErrorToast: true });
    return data;
  },
  async update(id: string, input: ConnectionInput): Promise<ConnectionsData> {
    const { data } = await apiClient.put<ConnectionsData>(`/admin/connections/${id}`, input, { suppressErrorToast: true });
    return data;
  },
  async remove(id: string): Promise<ConnectionsData> {
    const { data } = await apiClient.delete<ConnectionsData>(`/admin/connections/${id}`, { suppressErrorToast: true });
    return data;
  },
  async setRole(role: string, connectionId: string): Promise<ConnectionsData> {
    const { data } = await apiClient.put<ConnectionsData>('/admin/roles', { role, connectionId }, { suppressErrorToast: true });
    return data;
  },
  /** POST /admin/connections/models — list the models the provider offers. */
  async models(baseUrl: string, apiKey: string): Promise<string[]> {
    const { data } = await apiClient.post<{ models: string[] }>(
      '/admin/connections/models',
      { baseUrl, apiKey },
      { suppressErrorToast: true },
    );
    return data.models;
  },
};
