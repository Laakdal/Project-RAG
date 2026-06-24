// ========================================
// Auth type helper utilities
// ========================================
//
// Extracted from the workspace connectors admin route so the agent builder
// toolset credential dialogs can classify auth types without coupling to the
// (deleted) admin route tree.

function normalizeAuthTypeKey(authType: string): string {
  return (authType || '').toUpperCase();
}

/** Check if auth type requires no authentication (skip auth card) */
export function isNoneAuthType(authType: string): boolean {
  const u = normalizeAuthTypeKey(authType);
  return u === 'NONE' || u === '';
}

/** Check if auth type uses OAuth redirect flow (show authenticate button) */
export function isOAuthType(authType: string): boolean {
  return ['OAUTH'].includes(normalizeAuthTypeKey(authType));
}

/** Check if auth type uses credential fields (show form fields) */
export function isCredentialAuthType(authType: string): boolean {
  const upper = normalizeAuthTypeKey(authType);
  return [
    'API_TOKEN',
    'USERNAME_PASSWORD',
    'BEARER_TOKEN',
    'BASIC_AUTH',
    'ACCESS_KEY',
    'ACCOUNT_KEY',
    'CONNECTION_STRING',
    'CUSTOM',
  ].includes(upper);
}
