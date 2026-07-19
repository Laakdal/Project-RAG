import { describe, it, expect } from 'vitest';
import { ACTION_PRESETS, findResolution } from '../idss-options';
import type { IdssOptionsData } from '../../../utils/parse-idss-options';

/**
 * The picker recovers "already answered" by finding the follow-up turn it would
 * have sent. These cover the round-trip: build the prompt exactly as the button
 * does, then check it is recognised back.
 */

const userMsg = (text: string) => ({ role: 'user', content: [{ type: 'text', text }] });
const assistantMsg = (text: string) => ({ role: 'assistant', content: [{ type: 'text', text }] });

const multi: IdssOptionsData = {
  prompt: 'Which strategy?',
  multiSelect: true,
  action: 'prioritize',
  options: [
    { label: 'Hardware Upgrade', description: 'faster CPU' },
    { label: 'Mod Optimization Stack', description: 'Aki-Async' },
    { label: 'JVM Tuning', description: 'GC params' },
  ],
};

const single: IdssOptionsData = {
  prompt: 'Pick one',
  multiSelect: false,
  action: 'compare',
  options: [
    { label: 'Hardware Upgrade', description: 'faster CPU' },
    { label: 'JVM Tuning', description: 'GC params', followup: 'Explain JVM tuning in depth' },
  ],
};

describe('findResolution', () => {
  it('returns null when the thread has no matching follow-up', () => {
    const messages = [assistantMsg('here are options'), userMsg('something unrelated')];
    expect(findResolution(multi, ACTION_PRESETS.prioritize, messages)).toBeNull();
  });

  it('recovers a multi-select answer from the prompt the button builds', () => {
    const p = ACTION_PRESETS.prioritize;
    const sent = `${p.prefix}Hardware Upgrade, Mod Optimization Stack${p.suffix}`;
    expect(findResolution(multi, p, [assistantMsg('q'), userMsg(sent)])).toEqual([0, 1]);
  });

  it('returns indices sorted, regardless of the order in the sent text', () => {
    const p = ACTION_PRESETS.prioritize;
    const sent = `${p.prefix}JVM Tuning, Hardware Upgrade${p.suffix}`;
    expect(findResolution(multi, p, [userMsg(sent)])).toEqual([0, 2]);
  });

  it('ignores a multi-select match that resolves fewer than two labels', () => {
    const p = ACTION_PRESETS.prioritize;
    const sent = `${p.prefix}Hardware Upgrade${p.suffix}`;
    expect(findResolution(multi, p, [userMsg(sent)])).toBeNull();
  });

  it('ignores an unknown label inside an otherwise well-formed prompt', () => {
    const p = ACTION_PRESETS.prioritize;
    const sent = `${p.prefix}Hardware Upgrade, Something Else${p.suffix}`;
    expect(findResolution(multi, p, [userMsg(sent)])).toBeNull();
  });

  it('does not match a different action\'s prompt', () => {
    const rank = ACTION_PRESETS.rank;
    const sent = `${rank.prefix}Hardware Upgrade, JVM Tuning${rank.suffix}`;
    // The card is a "prioritize" card, so a rank-shaped turn is not its answer.
    expect(findResolution(multi, ACTION_PRESETS.prioritize, [userMsg(sent)])).toBeNull();
  });

  it('recovers a single-select pick via the default follow-up text', () => {
    const messages = [userMsg('Tell me more about: Hardware Upgrade')];
    expect(findResolution(single, ACTION_PRESETS.compare, messages)).toEqual([0]);
  });

  it('recovers a single-select pick via the option\'s custom followup', () => {
    const messages = [userMsg('Explain JVM tuning in depth')];
    expect(findResolution(single, ACTION_PRESETS.compare, messages)).toEqual([1]);
  });

  it('only considers user turns, not assistant echoes', () => {
    const p = ACTION_PRESETS.prioritize;
    const echoed = `${p.prefix}Hardware Upgrade, JVM Tuning${p.suffix}`;
    expect(findResolution(multi, p, [assistantMsg(echoed)])).toBeNull();
  });

  it('tolerates messages with no text parts', () => {
    const messages = [{ role: 'user', content: [{ type: 'image' }] }, { role: 'user' }];
    expect(findResolution(multi, ACTION_PRESETS.prioritize, messages)).toBeNull();
  });
});
