/**
 * BB-24 — A Mermaid block with broken/invalid syntax must degrade gracefully:
 * the component shows the "Could not render diagram" banner (and the raw source
 * on demand) instead of crashing or executing anything. Feeds deliberately
 * invalid mermaid through the REAL MermaidDiagram component and asserts the
 * error banner appears.
 */
import React from 'react';
import { render, cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MermaidDiagram } from '../mermaid-diagram';

// jsdom has no matchMedia; the component reads it for dark-mode detection.
if (!window.matchMedia) {
  // @ts-expect-error minimal stub for the test environment
  window.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

afterEach(cleanup);

describe('BB-24 — MermaidDiagram handles broken syntax gracefully', () => {
  it('shows the "Could not render diagram" banner for invalid source', async () => {
    const broken = 'graph TD\n  A --> \n  ??? this is not valid mermaid @@@ [[[';
    render(<MermaidDiagram chart={broken} />);

    // Error banner appears after the debounced render attempts fail. Generous
    // timeout to cover the 400ms debounce + async mermaid import.
    const banner = await screen.findByText(/Could not render diagram/i, {}, { timeout: 8000 });
    expect(banner).toBeTruthy();
    // The test budget MUST exceed the findBy wait above. vitest's default is
    // 5s, so this test could never have survived the full 8s wait — it only
    // passed because the render usually resolved early. Under parallel load
    // with the real mermaid bundle it does not.
  }, 20000);
});
