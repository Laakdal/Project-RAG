/**
 * Recognising the turn an IDSS picker sends.
 *
 * Choosing an option appends a normal user turn, so the assistant receives it
 * as an ordinary question and the choice survives in history. But it is a
 * BRANCH of the turn that offered the options, not a new question, so the
 * transcript renders it without a question heading — the answer follows the
 * "You chose: X" card directly.
 *
 * The match is on text, deliberately. Tagging the message at append time is the
 * obvious alternative, but a reload rebuilds the thread from the server, which
 * stores only role and content — the tag would vanish and every previously
 * hidden heading would come back. The text, on the other hand, is durable.
 *
 * It reuses the exact strings the picker sends (ACTION_PRESETS, singleFollowup),
 * which is also what findResolution reads to re-lock the card. One source of
 * truth: reword a prompt and the card's lock and the hidden heading move
 * together, or neither moves.
 */
import { parseIdssOptions, type IdssOptionsData } from '../../utils/parse-idss-options';
import { ACTION_PRESETS, singleFollowup } from './idss-options';

/** ```idss-options fences inside one answer, parsed. Malformed blocks are skipped. */
export function extractIdssBlocks(answer: string): IdssOptionsData[] {
  if (!answer.includes('idss-options')) return [];
  const blocks: IdssOptionsData[] = [];
  const fence = /```idss-options\s*\n([\s\S]*?)```/g;
  for (const match of answer.matchAll(fence)) {
    const data = parseIdssOptions(match[1]);
    if (data) blocks.push(data);
  }
  return blocks;
}

/**
 * True when `text` is a turn one of `blocks` would have sent.
 *
 * Mirrors findResolution: a multi-select block sends prefix + labels + suffix,
 * a single-select block sends one option's follow-up.
 *
 * Known limitation, shared with findResolution: typing text identical to an
 * option's follow-up by hand hides that heading too.
 */
export function isIdssFollowup(text: string, blocks: IdssOptionsData[]): boolean {
  const question = text.trim();
  if (!question) return false;

  return blocks.some((data) => {
    if (data.multiSelect) {
      const preset = ACTION_PRESETS[data.action] ?? ACTION_PRESETS.compare;
      if (!question.startsWith(preset.prefix) || !question.endsWith(preset.suffix)) return false;
      const inner = question.slice(preset.prefix.length, question.length - preset.suffix.length);
      const labels = inner.split(', ');
      return (
        labels.length >= 2 && labels.every((l) => data.options.some((o) => o.label === l))
      );
    }
    return data.options.some((o) => singleFollowup(o) === question);
  });
}
