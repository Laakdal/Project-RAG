/**
 * Copy Image must produce a LIGHT diagram even when the UI is dark, because
 * the PNG is rasterized onto a forced white background.
 */
import React from 'react';
// NOTE: use fireEvent, not user-event — @testing-library/user-event is not a
// dependency of this project.
import { render, cleanup, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MERMAID_THEMES } from '../mermaid-theme';

const initialize = vi.fn();
const renderFn = vi.fn(async (id: string) => ({ svg: `<svg id="${id}"></svg>` }));
vi.mock('mermaid', () => ({ default: { initialize, render: renderFn } }));

vi.mock('@/app/components/theme-provider', () => ({
  useThemeAppearance: () => ({
    appearance: 'dark',
    preference: 'dark',
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
  // jsdom has no canvas or font loading; stub what the export path touches.
  // @ts-expect-error test stub
  document.fonts = { ready: Promise.resolve() };
  // @ts-expect-error test stub
  HTMLCanvasElement.prototype.getContext = () => ({
    fillRect: () => {},
    drawImage: () => {},
    set fillStyle(_v: string) {},
  });
  // @ts-expect-error test stub
  HTMLCanvasElement.prototype.toBlob = (cb: (b: Blob) => void) =>
    cb(new Blob(['x'], { type: 'image/png' }));
  Object.defineProperty(Image.prototype, 'src', {
    set() {
      setTimeout(() => this.onload?.(), 0);
    },
    configurable: true,
  });
});
afterEach(cleanup);

describe('Copy Image export', () => {
  it('re-renders with the light palette before rasterizing', async () => {
    const { MermaidDiagram } = await import('../mermaid-diagram');
    render(<MermaidDiagram chart={'flowchart TD\n  A[One] --> B[Two]'} />);

    // Wait for the inline (dark) render to finish and the toolbar to appear.
    const button = await screen.findByTitle('Copy Image', {}, { timeout: 8000 });
    initialize.mockClear();

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => expect(initialize).toHaveBeenCalled());
    const palettes = initialize.mock.calls.map((c) => c[0]?.themeVariables);
    expect(palettes).toContainEqual(MERMAID_THEMES.light);
  });
});
