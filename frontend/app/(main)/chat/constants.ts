import type { QueryModeConfig } from './types';

// ── LLM Model Metadata Maps ──────────────────────────────────────────

/**
 * Maps provider API key → human-readable display name.
 * Add new providers here as they become available.
 */
export const PROVIDER_FRIENDLY_NAMES: Record<string, string> = {
  openAI: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  mistral: 'Mistral',
  meta: 'Meta',
  cohere: 'Cohere',
  groq: 'Groq',
};

/**
 * Maps model name → short one-liner description shown under the model name.
 * Keyed by modelName (exact match from API).
 */
export const MODEL_DESCRIPTIONS: Record<string, string> = {
  'gpt-4o-mini': 'Fast and affordable GPT-4 class model for everyday tasks',
  'gpt-4o': 'Flagship multimodal model with vision and audio support',
  'gpt-5.4': 'Most capable OpenAI model with advanced reasoning',
  'gpt-5.5': 'Advanced conversational AI with strong reasoning and multimodal capabilities',
  'gpt-5-nano': 'Compact and fast model optimised for quick responses',
  'claude-3-5-sonnet-20241022': 'Balanced performance and intelligence from Anthropic',
  'claude-3-7-sonnet-20250219': "Anthropic's most intelligent model yet",
  'claude-opus-4-5': 'Context-aware multimodal AI with real-time memory and understanding',
  'gemini-1.5-pro': 'Long context multimodal reasoning from Google',
  'gemini-2.5-flash': 'Fast and efficient Gemini model with next-gen features',
  'mistral-large-latest': 'Mistral\'s top-tier reasoning and instruction-following model',
};


/**
 * Query mode configurations for the mode selector panel.
 *
 * Each mode references CSS variables defined in globals.css
 * (--mode-{id}-bg, --mode-{id}-fg, --mode-{id}-icon).
 *
 * Disabled modes are shown in the panel but cannot be selected.
 * Enable them here once backend support is added.
 */
export const QUERY_MODES: QueryModeConfig[] = [
  {
    id: 'agent',
    label: 'Agent',
    toolbarLabel: 'chat.queryModes.agent.toolbarLabel',
    description: 'Delegate multi-step reasoning and tool use with a configurable strategy',
    icon: 'smart_toy',
    iconType: 'material',
    colors: {
      bg: 'var(--mode-agent-bg)',
      fg: 'var(--mode-agent-fg)',
      icon: 'var(--mode-agent-icon)',
      toggle: 'var(--mode-agent-toggle)',
    },
    enabled: true,
  },
  {
    id: 'chat',
    label: 'Internal Search',
    toolbarLabel: 'chat.queryModes.chat.toolbarLabel',
    description: 'Search and reason across your internal knowledge base',
    icon: 'chat-star',
    iconType: 'component',
    colors: {
      bg: 'var(--mode-chat-bg)',
      fg: 'var(--mode-chat-fg)',
      icon: 'var(--mode-chat-icon)',
      toggle: 'var(--mode-chat-active-toggle)',
    },
    enabled: true,
  },
];

/**
 * Returns the QueryModeConfig for a given query mode ID.
 */
export function getQueryModeConfig(id: string): QueryModeConfig | undefined {
  return QUERY_MODES.find((m) => m.id === id);
}


/** Maximum number of visible chats in the sidebar. */
export const MAX_VISIBLE_CHATS = 10;

/** Number of conversations fetched per page in the More Chats infinite scroll panel. */
export const MORE_CHATS_PAGE_SIZE = 20;

/** Page size for the chat sidebar Agents panel (search + infinite scroll). */
export const AGENTS_SIDEBAR_PAGE_SIZE = 20;


/** Page size for the initial agent sidebar conversations fetch (page 1). */
export const SIDEBAR_AGENT_CONVERSATIONS_PAGE_SIZE = 10;

/** Page size for GET /api/v1/agents/:id/conversations in the More panel (infinite scroll). */
export const AGENT_CONVERSATIONS_PAGE_SIZE = 20;

/** Number of messages fetched per page when loading a conversation (initial load and
 *  "load older messages" infinite scroll). Must match the backend's default limit. */
export const CONVERSATION_MESSAGES_PAGE_SIZE = 20;
