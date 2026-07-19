import { apiClient } from '@/lib/api';

export interface DriveSource {
  id: string;
  name: string;
  folderId: string;
  /** Whether a service-account key is stored (the key itself is never returned). */
  hasKey: boolean;
}

export interface DriveSourceInput {
  name: string;
  folderId: string;
  /** Optional on update — blank keeps the stored key. */
  serviceAccountJson?: string;
}

export const DriveSourcesApi = {
  async get(): Promise<DriveSource[]> {
    const { data } = await apiClient.get<{ sources: DriveSource[] }>('/admin/drive-sources', { suppressErrorToast: true });
    return data.sources;
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
};
