import type { CapabilitySection } from './types';

const CAPABILITY_LABEL: Record<string, string> = {
  text_generation: 'LLM',
  embedding: 'Embedding',
  image_generation: 'Image Generation',
  tts: 'Text to Speech',
  stt: 'Speech to Text',
  reasoning: 'Reasoning',
  video: 'Video',
  ocr: 'OCR',
};

/**
 * Badge text per capability. An empty string means the locale file had no
 * badge value; the getter falls back to the label in that case.
 */
const CAPABILITY_BADGE: Record<string, string> = {
  text_generation: 'LLM',
  embedding: 'Embedding',
  image_generation: 'Image',
  reasoning: 'Reasoning',
  video: 'Multimodal',
  // tts, stt, ocr intentionally omitted — fallback to label
};

const CAPABILITY_SECTION_TAB: Record<string, string> = {
  text_generation: 'For LLMs',
  embedding: 'For Embedding',
  image_generation: 'For Image Generation',
};

export function aiModelsCapabilityLabel(cap: string): string {
  return CAPABILITY_LABEL[cap] ?? cap;
}

/** Badge text for registry capabilities; falls back to label when no badge is defined. */
export function aiModelsCapabilityBadge(cap: string): string {
  const badge = CAPABILITY_BADGE[cap];
  if (badge !== undefined) return badge;
  return aiModelsCapabilityLabel(cap);
}

export function aiModelsCapabilitySectionTab(section: CapabilitySection): string {
  return CAPABILITY_SECTION_TAB[section] ?? aiModelsCapabilityLabel(section);
}
