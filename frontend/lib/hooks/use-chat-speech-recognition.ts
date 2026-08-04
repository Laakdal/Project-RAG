'use client';

import { isElectron } from '@/lib/electron';

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
   * path is unavailable: Electron's packaged `app://` origin cannot use
   * Chrome's upstream speech service, Brave/Edge should always use our
   * server STT path, and some browsers do not expose the Web Speech
   * recognizer at all. `'stt-not-configured'` when no provider is set;
   * `null` when voice input is available.
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

  // In Electron the browser path is non-functional regardless of what
  // `window.SpeechRecognition` reports: Chromium ships the API surface,
  // but the upstream Google speech endpoint rejects requests from the
  // `app://` origin / missing API key, so the recognizer ends ~instantly
  // after `start()`. Brave and Edge should also use a configured server STT
  // route instead of the browser recognizer. Some browsers expose no
  // recognizer at all. Surface these cases to the UI so the mic button can be
  // disabled with an explanatory "configure STT" tooltip instead of silently
  // failing.
  const requiresServerStt =
    isElectron() || isBraveBrowser() || isEdgeBrowser() || !active.isSupported;
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
