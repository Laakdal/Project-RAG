import { apiClient } from '@/lib/api';

export interface LibrarySyncResult {
  added: number;
  updated: number;
  deleted: number;
  skipped: number;
  failed: number;
  failures: { driveFileId: string; error: string }[];
}

export interface LibraryStatus {
  total: number;
  failed: number;
  lastIndexedAt: string | null;
}

export const LibraryApi = {
  /** POST /library/sync — admin-only; triggers an incremental Drive sync. */
  async sync(): Promise<LibrarySyncResult> {
    const { data } = await apiClient.post<LibrarySyncResult>('/library/sync', {}, { suppressErrorToast: true });
    return data;
  },

  /** GET /library/status — indexed document counts + last sync time. */
  async status(): Promise<LibraryStatus> {
    const { data } = await apiClient.get<LibraryStatus>('/library/status', { suppressErrorToast: true });
    return data;
  },
};

export default LibraryApi;
