import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { IdssOptionsData } from '../../../utils/parse-idss-options';

/** Thread messages the mocked useThread will report; set per test. */
let messages: unknown[] = [];
const append = vi.fn();

vi.mock('@assistant-ui/react', () => ({
  useThread: () => ({ messages }),
  useThreadRuntime: () => ({ append }),
}));

import { ACTION_PRESETS } from '../idss-options';
import { IdssOptions } from '../idss-options';

const userMsg = (text: string) => ({ role: 'user', content: [{ type: 'text', text }] });

const data: IdssOptionsData = {
  prompt: 'Which strategy should we prioritise?',
  multiSelect: true,
  action: 'prioritize',
  options: [
    { label: 'Hardware Upgrade', description: 'faster CPU' },
    { label: 'Mod Optimization Stack', description: 'Aki-Async' },
    { label: 'JVM Tuning', description: 'GC params' },
  ],
};

describe('IdssOptions', () => {
  beforeEach(() => {
    messages = [];
    append.mockClear();
  });

  it('is interactive while the question is unanswered', () => {
    render(<IdssOptions data={data} />);
    expect(screen.getByText('Which strategy should we prioritise?')).toBeTruthy();
    expect(screen.getByText('Prioritize selected')).toBeTruthy();
    // All option rows are present and selectable.
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('collapses to a one-line summary once the thread contains the answer', () => {
    const p = ACTION_PRESETS.prioritize;
    messages = [userMsg(`${p.prefix}Hardware Upgrade, Mod Optimization Stack${p.suffix}`)];

    render(<IdssOptions data={data} />);

    // Summary replaces the question.
    expect(screen.getByText('Prioritized: Hardware Upgrade, Mod Optimization Stack')).toBeTruthy();
    expect(screen.queryByText('Which strategy should we prioritise?')).toBeNull();
    // Collapsed: no rows, and no way to submit again.
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.queryByText('Prioritize selected')).toBeNull();
  });

  it('expands the resolved picker to the chosen rows only, still not submittable', () => {
    const p = ACTION_PRESETS.prioritize;
    messages = [userMsg(`${p.prefix}Hardware Upgrade, Mod Optimization Stack${p.suffix}`)];

    render(<IdssOptions data={data} />);
    fireEvent.click(screen.getByLabelText('Show options'));

    // Once answered the card is a record of the DECISION, not of the menu:
    // the options that were not taken are gone rather than dimmed.
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByText('Hardware Upgrade')).toBeTruthy();
    expect(screen.getByText('Mod Optimization Stack')).toBeTruthy();
    expect(screen.queryByText('JVM Tuning')).toBeNull();
    // The action button stays gone.
    expect(screen.queryByText('Prioritize selected')).toBeNull();

    // Clicking a row must not send another turn.
    fireEvent.click(screen.getAllByRole('option')[0]);
    expect(append).not.toHaveBeenCalled();
  });

  it('expands a resolved single-select to just the one option chosen', () => {
    const singleData: IdssOptionsData = { ...data, multiSelect: false, action: 'compare' };
    messages = [userMsg('Tell me more about: JVM Tuning')];

    render(<IdssOptions data={singleData} />);
    fireEvent.click(screen.getByLabelText('Show options'));

    const rows = screen.getAllByRole('option');
    expect(rows).toHaveLength(1);
    expect(screen.getByText('JVM Tuning')).toBeTruthy();
    expect(screen.getByText('GC params')).toBeTruthy();
    expect(screen.queryByText('Hardware Upgrade')).toBeNull();
  });

  it('locks immediately on submit, before the turn reaches the thread', () => {
    render(<IdssOptions data={data} />);

    fireEvent.click(screen.getAllByRole('option')[0]);
    fireEvent.click(screen.getAllByRole('option')[1]);
    fireEvent.click(screen.getByText('Prioritize selected'));

    expect(append).toHaveBeenCalledTimes(1);
    // messages is still empty (no runtime), so this proves the local echo works.
    expect(screen.getByText('Prioritized: Hardware Upgrade, Mod Optimization Stack')).toBeTruthy();
    expect(screen.queryByText('Prioritize selected')).toBeNull();
  });

  it('recovers a single-select pick and names the chosen option', () => {
    const singleData: IdssOptionsData = { ...data, multiSelect: false, action: 'compare' };
    messages = [userMsg('Tell me more about: JVM Tuning')];

    render(<IdssOptions data={singleData} />);
    expect(screen.getByText('You chose: JVM Tuning')).toBeTruthy();
  });
});
