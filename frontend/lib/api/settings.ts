import { apiClient } from '@/lib/api';

/** One managed setting as returned by the admin settings API. */
export interface ManagedSetting {
  key: string;
  label: string;
  /** Secret values are never sent to the client — only whether they are set. */
  secret: boolean;
  /** UI hint: render a textarea instead of a single-line input. */
  multiline: boolean;
  isSet: boolean;
  source: 'db' | 'env' | 'unset';
  /** Present for non-secret settings so they can be edited in place. */
  value?: string;
}

export const SettingsApi = {
  /** GET /admin/settings */
  async list(): Promise<ManagedSetting[]> {
    const { data } = await apiClient.get<{ settings: ManagedSetting[] }>('/admin/settings', {
      suppressErrorToast: true,
    });
    return data.settings;
  },

  /** PUT /admin/settings — upsert one key; returns the refreshed list. */
  async update(key: string, value: string): Promise<ManagedSetting[]> {
    const { data } = await apiClient.put<{ settings: ManagedSetting[] }>(
      '/admin/settings',
      { key, value },
      { suppressErrorToast: true },
    );
    return data.settings;
  },
};
