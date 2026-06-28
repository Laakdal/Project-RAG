'use client';

interface SpeechCapabilitySummary {
  provider: string;
  /**
   * Active (default) model id the server will dispatch to. Mirrors
   * `defaultModel`; retained for backwards compatibility with clients that
   * were written before the field was added.
   */
  model: string | null;
  /** Model id the server uses when no explicit override is passed. */
  defaultModel?: string | null;
  /** All models exposed by the active provider config, in admin order. */
  models?: string[];
  /**
   * `true` when the returned config was picked because it is flagged
   * `isDefault` in `aiModels`; `false` when no entry was flagged and the
   * server fell back to the first configured one.
   */
  isDefault?: boolean;
  /** Stable identifier assigned to the config entry by the admin UI. */
  modelKey?: string | null;
  friendlyName?: string | null;
}

export interface ChatSpeechConfig {
  /** True when an admin has configured a server-side STT provider. */
  hasStt: boolean;
  /** True when an admin has configured a server-side TTS provider. */
  hasTts: boolean;
  tts: SpeechCapabilitySummary | null;
  stt: SpeechCapabilitySummary | null;
  /** True while the initial capabilities fetch is in-flight. */
  isLoading: boolean;
  /** Error from the capabilities endpoint, if any. */
  error: unknown;
}

/**
 * Server speech (TTS/STT) capabilities for the chat UI.
 *
 * The server endpoint (/api/v1/chat/speech/capabilities) does not exist on the
 * RAG backend, so it 404s on chat load. Rather than fire a doomed request, this
 * reports "unconfigured" — the chat UI then always falls back to the browser's
 * Web Speech API (the same behavior the fetch previously degraded to on error).
 * Restore the capabilities fetch when a server-side TTS/STT provider is wired.
 */
export function useChatSpeechConfig(): ChatSpeechConfig {
  return {
    hasTts: false,
    hasStt: false,
    tts: null,
    stt: null,
    isLoading: false,
    error: null,
  };
}
