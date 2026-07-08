/**
 * Parser for the ```idss-options fenced block the RAG answer may emit for
 * brainstorming questions. The block body is a single JSON object describing a
 * set of option cards. Parsing is deliberately defensive: the block can arrive
 * partial (mid-stream) or malformed, so this NEVER throws — it returns null and
 * the renderer shows nothing until a well-formed block is available.
 */

export interface IdssOption {
  label: string;
  description?: string;
  followup?: string;
}

/**
 * The action a multi-select block's button performs. Chosen by the LLM from the
 * question's intent so the button label + the follow-up turn it sends match what
 * the user actually asked (prioritise vs. rank vs. compare), instead of always
 * being "Compare selected". Unknown/absent → 'compare' (backwards compatible).
 */
export const IDSS_ACTIONS = ['compare', 'prioritize', 'rank'] as const;
export type IdssAction = (typeof IDSS_ACTIONS)[number];

export interface IdssOptionsData {
  multiSelect: boolean;
  action: IdssAction;
  prompt?: string;
  options: IdssOption[];
}

export function parseIdssOptions(raw: string): IdssOptionsData | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.options)) return null;

  const options: IdssOption[] = [];
  for (const item of obj.options) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.label !== 'string' || o.label.trim() === '') continue;
    options.push({
      label: o.label,
      description: typeof o.description === 'string' ? o.description : undefined,
      followup: typeof o.followup === 'string' ? o.followup : undefined,
    });
  }
  if (options.length === 0) return null;

  return {
    multiSelect: obj.multiSelect === true,
    action:
      typeof obj.action === 'string' && (IDSS_ACTIONS as readonly string[]).includes(obj.action)
        ? (obj.action as IdssAction)
        : 'compare',
    prompt: typeof obj.prompt === 'string' ? obj.prompt : undefined,
    options,
  };
}
