/**
 * The component must hand mermaid the palette for the CURRENT appearance
 * before rendering — not render light and re-colour afterwards.
 */
import React from 'react';
import { render, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MERMAID_THEMES } from '../mermaid-theme';

const initialize = vi.fn();
const renderFn = vi.fn(async (id: string) => ({ svg: `<svg id="${id}"></svg>` }));

vi.mock('mermaid', () => ({ default: { initialize, render: renderFn } }));

let appearance: 'light' | 'dark' = 'light';
vi.mock('@/app/components/theme-provider', () => ({
  useThemeAppearance: () => ({
    appearance,
    preference: appearance,
    setPreference: () => {},
  }),
}));

if (!window.matchMedia) {
  // @ts-expect-error minimal stub for the test environment
  window.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

beforeEach(() => {
  initialize.mockClear();
  renderFn.mockClear();
});
afterEach(cleanup);

/** Last themeVariables object handed to mermaid.initialize. */
function lastPalette() {
  const call = initialize.mock.calls.at(-1);
  return call?.[0]?.themeVariables;
}

describe('MermaidDiagram theme application', () => {
  it('initializes with the dark palette when appearance is dark', async () => {
    appearance = 'dark';
    const { MermaidDiagram } = await import('../mermaid-diagram');
    render(<MermaidDiagram chart={'flowchart TD\n  A[One] --> B[Two]'} />);

    await waitFor(() => expect(initialize).toHaveBeenCalled(), { timeout: 8000 });
    expect(lastPalette()).toEqual(MERMAID_THEMES.dark);
  });

  it('initializes with the light palette when appearance is light', async () => {
    appearance = 'light';
    const { MermaidDiagram } = await import('../mermaid-diagram');
    render(<MermaidDiagram chart={'flowchart TD\n  A[One] --> B[Two]'} />);

    await waitFor(() => expect(initialize).toHaveBeenCalled(), { timeout: 8000 });
    expect(lastPalette()).toEqual(MERMAID_THEMES.light);
  });

  it('does not splice a dark-override style block into the SVG', async () => {
    appearance = 'dark';
    const { MermaidDiagram } = await import('../mermaid-diagram');
    const { container } = render(
      <MermaidDiagram chart={'flowchart TD\n  A[One] --> B[Two]'} />,
    );

    await waitFor(() => expect(renderFn).toHaveBeenCalled(), { timeout: 8000 });
    await waitFor(() =>
      expect(container.innerHTML).not.toContain('rag-diagram-dark'),
    );
  });
});
