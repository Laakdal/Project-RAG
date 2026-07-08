import { parseIdssOptions } from '../parse-idss-options';

describe('parseIdssOptions', () => {
  it('parses a valid single-select block body', () => {
    const raw = JSON.stringify({
      multiSelect: false,
      prompt: 'Which direction?',
      options: [
        { label: 'A', description: 'rationale a', followup: 'go deeper on A' },
        { label: 'B' },
      ],
    });
    const data = parseIdssOptions(raw);
    expect(data).not.toBeNull();
    expect(data!.multiSelect).toBe(false);
    expect(data!.prompt).toBe('Which direction?');
    expect(data!.options).toHaveLength(2);
    expect(data!.options[0]).toEqual({ label: 'A', description: 'rationale a', followup: 'go deeper on A' });
    expect(data!.options[1].label).toBe('B');
  });

  it('coerces multiSelect to a boolean and defaults it to false', () => {
    const raw = JSON.stringify({ options: [{ label: 'A' }] });
    expect(parseIdssOptions(raw)!.multiSelect).toBe(false);
  });

  it('parses a valid action and defaults it to "compare" when absent or invalid', () => {
    expect(
      parseIdssOptions(JSON.stringify({ action: 'prioritize', options: [{ label: 'A' }] }))!.action,
    ).toBe('prioritize');
    expect(
      parseIdssOptions(JSON.stringify({ action: 'rank', options: [{ label: 'A' }] }))!.action,
    ).toBe('rank');
    // Missing → default
    expect(parseIdssOptions(JSON.stringify({ options: [{ label: 'A' }] }))!.action).toBe('compare');
    // Unknown / wrong type → default
    expect(
      parseIdssOptions(JSON.stringify({ action: 'delete-everything', options: [{ label: 'A' }] }))!
        .action,
    ).toBe('compare');
    expect(
      parseIdssOptions(JSON.stringify({ action: 42, options: [{ label: 'A' }] }))!.action,
    ).toBe('compare');
  });

  it('returns null for malformed JSON (e.g. mid-stream partial)', () => {
    expect(parseIdssOptions('{ "multiSelect": false, "options": [ { "lab')).toBeNull();
  });

  it('returns null when options is missing, empty, or not an array', () => {
    expect(parseIdssOptions(JSON.stringify({ multiSelect: true }))).toBeNull();
    expect(parseIdssOptions(JSON.stringify({ options: [] }))).toBeNull();
    expect(parseIdssOptions(JSON.stringify({ options: 'nope' }))).toBeNull();
  });

  it('drops option entries without a string label, and null-out if none remain', () => {
    const raw = JSON.stringify({ options: [{ description: 'no label' }, { label: 'Keep' }] });
    const data = parseIdssOptions(raw);
    expect(data!.options).toHaveLength(1);
    expect(data!.options[0].label).toBe('Keep');
    expect(parseIdssOptions(JSON.stringify({ options: [{ description: 'x' }] }))).toBeNull();
  });
});
