'use client';


import { useChatSpeechConfig } from './use-chat-speech-config';
import { useSpeechRecognition } from './use-speech-recognition';

interface NavigatorWithBrave extends Navigator {
  brave?: {
    isBrave?: () => Promise<boolean>;
  };
}

interface UseChatSpeechRecognitionOptions {
  lang?: string;
  continuous?: boolean;
  interimResults?: boolean;
  onError?: (error: string) => void;
}

interface UseChatSpeechRecognitionReturn {
  isListening: boolean;
  isSupported: boolean;
  transcript: string;
  interimTranscript: string;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  resetTranscript: () => void;
  /**
   * Voice input requires a configured server STT provider when the browser
   * path is unavailable: Brave/Edge should always use a server STT path, and
   * some browsers do not expose the Web Speech recognizer at all.
   * `'stt-not-configured'` when no provider is set; `null` when voice input
   * is available.
   */
  unavailableReason: 'stt-not-configured' | null;
}

function isBraveBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return Boolean((navigator as NavigatorWithBrave).brave?.isBrave);
}

function isEdgeBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /\b(?:Edg|EdgA|EdgiOS|Edge)\//.test(navigator.userAgent);
}

/**
 * Composite speech-recognition hook used by the chat UI.
 *
 * Transcription always runs through the browser's native
 * `window.SpeechRecognition`. The server STT route it used to be able to pick
 * (`POST /api/v1/chat/transcribe`) is not served by this backend, and
 * `useChatSpeechConfig` reports `hasStt: false` unconditionally, so that branch
 * could never be taken.
 */
export function useChatSpeechRecognition(
  options: UseChatSpeechRecognitionOptions = {}
): UseChatSpeechRecognitionReturn {
  const { hasStt } = useChatSpeechConfig();

  const active = useSpeechRecognition(options);

  // Brave and Edge should use a configured server STT route rather than the
  // browser recognizer, and some browsers expose no recognizer at all. Surface
  // these cases to the UI so the mic button can be disabled with an explanatory
  // "configure STT" tooltip instead of silently failing.
  const requiresServerStt =
    isBraveBrowser() || isEdgeBrowser() || !active.isSupported;
  const unavailableReason: UseChatSpeechRecognitionReturn['unavailableReason'] =
    requiresServerStt && !hasStt ? 'stt-not-configured' : null;

  return {
    isListening: active.isListening,
    isSupported: unavailableReason ? false : active.isSupported,
    transcript: active.transcript,
    interimTranscript: active.interimTranscript,
    start: active.start,
    stop: active.stop,
    toggle: active.toggle,
    resetTranscript: active.resetTranscript,
    unavailableReason,
  };
}
