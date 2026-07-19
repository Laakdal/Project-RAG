import { apiClient } from '@/lib/api';

export interface DriveSource {
  id: string;
  name: string;
  folderId: string;
  clientId: string;
  /** Whether the account has been signed in (a refresh token is stored). */
  connected: boolean;
}

export interface DriveSourceInput {
  name: string;
  clientId: string;
  /** Optional on update — blank keeps the stored secret. */
  clientSecret?: string;
  folderId?: string;
}

export interface DriveSourcesData {
  sources: DriveSource[];
  /** The OAuth redirect URI to register in the Google OAuth client. */
  redirectUrl: string;
}

export const DriveSourcesApi = {
  async get(): Promise<DriveSourcesData> {
    const { data } = await apiClient.get<DriveSourcesData>('/admin/drive-sources', { suppressErrorToast: true });
    return data;
  },
  async create(input: DriveSourceInput): Promise<DriveSource[]> {
    const { data } = await apiClient.post<{ sources: DriveSource[] }>('/admin/drive-sources', input, { suppressErrorToast: true });
    return data.sources;
  },
  async update(id: string, input: DriveSourceInput): Promise<DriveSource[]> {
    const { data } = await apiClient.put<{ sources: DriveSource[] }>(`/admin/drive-sources/${id}`, input, { suppressErrorToast: true });
    return data.sources;
  },
  async remove(id: string): Promise<DriveSource[]> {
    const { data } = await apiClient.delete<{ sources: DriveSource[] }>(`/admin/drive-sources/${id}`, { suppressErrorToast: true });
    return data.sources;
  },
  /** GET the "Sign in with Google" URL for a source. */
  async authorizeUrl(id: string): Promise<string> {
    const { data } = await apiClient.get<{ url: string }>(`/admin/drive-sources/${id}/authorize`, { suppressErrorToast: true });
    return data.url;
  },
};
