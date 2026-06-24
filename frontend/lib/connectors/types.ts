// ========================================
// Shared connector types
// ========================================
//
// Extracted from the workspace connectors admin route so the agent builder,
// toolsets API, chat, and knowledge-base features can depend on the connector
// data shapes without coupling to the (deleted) admin route tree.

/** Scope determines whether we're viewing team or personal connectors. */
export type ConnectorScope = 'team' | 'personal';

/**
 * Core connector object returned by both the active-list
 * and registry endpoints.
 */
export interface Connector {
  _key?: string;
  name: string;
  type: string;
  appGroup: string;
  appDescription: string;
  appCategories: string[];
  iconPath: string;
  supportedAuthTypes: string[];
  supportsRealtime: boolean;
  supportsSync: boolean;
  supportsAgent: boolean;
  /** Documentation links promoted from config; present on list responses. */
  documentationLinks?: DocumentationLink[];
  /** Promoted from config; used for team connector admin-access prompt. */
  isAdminAccessRequired?: boolean;
  /** Promoted from config; redirect target when user lacks native-app admin access. */
  personalConnectorType?: string | null;
  scope: string;
  /** Only present on active connectors. */
  isActive: boolean;
  isAgentActive: boolean;
  isConfigured: boolean;
  isAuthenticated: boolean;
  pendingFullSync?: boolean;
  createdAtTimestamp?: number;
  updatedAtTimestamp?: number;
  createdBy?: string;
  updatedBy?: string;
  authType?: string;
  connectorInfo?: string | Record<string, unknown> | null;
  config?: Record<string, unknown>;
  /** Transient operational status from the backend. */
  status?: string | null;
}

/** API list response shape. */
export interface ConnectorListResponse {
  success: boolean;
  connectors: Connector[];
}

// ========================================
// Field types (shared across auth, sync, filter)
// ========================================

/**
 * Mirror of Python ``ValidationRuleType``.
 * Keep values in sync — they are the wire format exchanged with the backend.
 */
export const ValidationRuleType = {
  JSON_VALID:        'json_valid',
  JSON_HAS_FIELDS:   'json_has_fields',
  JSON_FIELD_EQUALS: 'json_field_equals',
  TEXT_CONTAINS:     'text_contains',
  TEXT_NOT_CONTAINS: 'text_not_contains',
} as const;

export type ValidationRuleTypeValue = typeof ValidationRuleType[keyof typeof ValidationRuleType];

export interface ValidationRule {
  type: ValidationRuleTypeValue;
  /** For json_has_fields: list of required top-level keys */
  requiredFields?: string[];
  /** For json_field_equals: the key to check */
  field?: string;
  /** For json_field_equals: the expected value */
  value?: string;
  /** For text_contains / text_not_contains: substring or PEM marker to test */
  pattern?: string;
  /** Human-readable error shown when the rule fails. Supports {missing} placeholder for json_has_fields. */
  errorMessage?: string;
}

/**
 * Shared validation payload from connector/sync schemas.
 * The backend omits `acceptedFileTypes` and `validationRules` unless
 * `fieldType === 'FILE'` — treat them as absent unless the field is a file input.
 */
export interface FieldValidation {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  /** Present when `fieldType === 'FILE'` (wire schema from Python). */
  acceptedFileTypes?: string[];
  /** Present when `fieldType === 'FILE'`. Ordered rules on file content after selection. */
  validationRules?: ValidationRule[];
}

export interface AuthSchemaField {
  name: string;
  displayName: string;
  placeholder?: string;
  description?: string;
  fieldType:
    | 'TEXT'
    | 'PASSWORD'
    | 'EMAIL'
    | 'URL'
    | 'TEXTAREA'
    | 'SELECT'
    | 'MULTISELECT'
    | 'CHECKBOX'
    | 'NUMBER'
    | 'FILE'
    | 'TAGS'
    | 'FOLDER';
  required?: boolean;
  defaultValue?: unknown;
  options?: string[];
  validation?: FieldValidation;
  isSecret?: boolean;
  /**
   * Optional labeled example values rendered below the input as a compact
   * copyable note.
   */
  examples?: { label: string; value: string }[];
}

export interface SyncCustomField {
  name: string;
  displayName: string;
  description?: string;
  fieldType:
    | 'TEXT'
    | 'PASSWORD'
    | 'EMAIL'
    | 'URL'
    | 'TEXTAREA'
    | 'SELECT'
    | 'MULTISELECT'
    | 'CHECKBOX'
    | 'NUMBER'
    | 'FILE'
    | 'JSON'
    | 'BOOLEAN'
    | 'TAGS'
    | 'FOLDER';
  required?: boolean;
  defaultValue?: unknown;
  options?: string[];
  validation?: FieldValidation;
  isSecret?: boolean;
  nonEditable?: boolean;
}

export interface FilterSchemaField {
  name: string;
  displayName: string;
  description?: string;
  fieldType?:
    | 'TEXT'
    | 'SELECT'
    | 'MULTISELECT'
    | 'DATE'
    | 'DATERANGE'
    | 'NUMBER'
    | 'BOOLEAN'
    | 'TAGS';
  filterType?: 'list' | 'datetime' | 'text' | 'string' | 'number' | 'boolean' | 'multiselect';
  category?: 'sync' | 'indexing';
  required?: boolean;
  defaultValue?: unknown;
  defaultOperator?: string;
  /** When true, empty operator row stays empty (no fallback to operators[0]). */
  noImplicitOperatorDefault?: boolean;
  operators?: string[];
  optionSourceType?: 'manual' | 'static' | 'dynamic';
  options?: { id: string; label: string }[];
}

/** Union field type for SchemaFormField component */
export type SchemaField = AuthSchemaField | SyncCustomField | FilterSchemaField;

// ========================================
// Schema response structures
// ========================================

export interface DocumentationLink {
  title: string;
  url: string;
  type: 'setup' | 'api' | 'connector' | 'pipeshub';
}

export interface ConditionalDisplayRule {
  field: string;
  operator:
    | 'equals'
    | 'not_equals'
    | 'contains'
    | 'not_contains'
    | 'greater_than'
    | 'less_than'
    | 'is_empty'
    | 'is_not_empty';
  value?: unknown;
}

export interface ConditionalDisplayConfig {
  [key: string]: { showWhen: ConditionalDisplayRule };
}

export interface AuthSchemaDefinition {
  fields: AuthSchemaField[];
  redirectUri?: string;
  displayRedirectUri?: boolean;
}

export interface ConnectorAuthConfig {
  type?: string;
  supportedAuthTypes: string[];
  displayRedirectUri?: boolean;
  redirectUri?: string;
  conditionalDisplay?: ConditionalDisplayConfig;
  schema?: AuthSchemaDefinition;
  schemas?: Record<string, AuthSchemaDefinition>;
  values: Record<string, unknown>;
  customFields?: AuthSchemaField[];
  customValues?: Record<string, unknown>;
}
