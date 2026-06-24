// ========================================
// Auth type display name
// ========================================
//
// Extracted from the workspace connectors admin route so the agent builder
// toolset credential dialogs can label auth types without coupling to the
// (deleted) admin route tree.

/**
 * Format auth type enum to display name.
 */
export function formatAuthTypeName(authType: string): string {
  const map: Record<string, string> = {
    OAUTH: 'OAuth 2.0',
    OAUTH_ADMIN_CONSENT: 'OAuth (Admin Consent)',
    OAUTH_CERTIFICATE: 'OAuth (Certificate)',
    API_TOKEN: 'API Token',
    USERNAME_PASSWORD: 'Username & Password',
    BASIC_AUTH: 'Basic authentication',
    BEARER_TOKEN: 'Bearer Token',
    CUSTOM: 'Custom',
    NONE: 'None',
  };
  return map[authType] || authType;
}
