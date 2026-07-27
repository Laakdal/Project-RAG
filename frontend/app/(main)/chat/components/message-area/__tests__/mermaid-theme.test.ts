/**
 * The dark palette exists to fix two specific defects that the old
 * post-render CSS patch could not reach:
 *  - flowchart/ER edge labels drew light text on a light `edgeLabelBackground`
 *  - class/ER/mindmap nodes fell through to mermaid defaults instead of jade
 * These tests pin the contract rather than exact hex values, except where a
 * specific value is the fix.
 */
import { describe, expect, it } from 'vitest';
import { MERMAID_BASE_CONFIG, MERMAID_THEMES } from '../mermaid-theme';

/** Relative luminance (WCAG) of a #rrggbb string, 0 = black, 1 = white. */
function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

describe('MERMAID_THEMES', () => {
  it('defines the same variables in both palettes', () => {
    expect(Object.keys(MERMAID_THEMES.dark).sort()).toEqual(
      Object.keys(MERMAID_THEMES.light).sort(),
    );
  });

  it('gives dark mode a dark edge-label background', () => {
    // The original defect: label background stayed light while text went light.
    expect(luminance(MERMAID_THEMES.dark.edgeLabelBackground)).toBeLessThan(0.2);
    expect(luminance(MERMAID_THEMES.light.edgeLabelBackground)).toBeGreaterThan(0.5);
  });

  it('keeps text readable against node fill in both palettes', () => {
    for (const name of ['light', 'dark'] as const) {
      const text = luminance(MERMAID_THEMES[name].primaryTextColor);
      const fill = luminance(MERMAID_THEMES[name].primaryColor);
      const contrast =
        (Math.max(text, fill) + 0.05) / (Math.min(text, fill) + 0.05);
      expect(contrast).toBeGreaterThan(4.5);
    }
  });

  it('keeps ER attribute rows readable against the shared text colour', () => {
    // Regression: dark mode set textColor light but left the ER attribute rows
    // on mermaid's derived light jade, so every attribute was invisible.
    // mermaid 11's erBox reads `rowOdd`/`rowEven` — NOT the documented
    // `attributeBackgroundColor*` aliases, which it never consults. Without
    // these, rowOdd falls back to lighten(mainBkg, 75) — a near-white jade.
    for (const name of ['light', 'dark'] as const) {
      const text = luminance(MERMAID_THEMES[name].textColor);
      for (const row of ['rowOdd', 'rowEven'] as const) {
        const bg = luminance(MERMAID_THEMES[name][row]);
        const contrast =
          (Math.max(text, bg) + 0.05) / (Math.min(text, bg) + 0.05);
        expect(contrast, `${name}.${row}`).toBeGreaterThan(4.5);
      }
    }
  });

  it('pins all 12 mindmap section colours in both palettes', () => {
    for (const name of ['light', 'dark'] as const) {
      for (let i = 0; i < 12; i++) {
        expect(MERMAID_THEMES[name][`cScale${i}`], `${name}.cScale${i}`).toBeTruthy();
      }
    }
  });

  it('never lets a mindmap section collapse to black', () => {
    // Regression: mermaid derives cScale{i} by REDUCING lightness from the
    // palette base — valid only for a light base. The dark palette drove every
    // section to hsl(H, S%, 0%): pure black nodes on a near-black surface, so
    // the mindmap read as black holes with no visible node boxes.
    for (const name of ['light', 'dark'] as const) {
      for (let i = 0; i < 12; i++) {
        const value = MERMAID_THEMES[name][`cScale${i}`];
        const l = value.match(/hsl\([^,]+,[^,]+,\s*([\d.]+)%\)/);
        expect(l, `${name}.cScale${i} should be an hsl() string`).not.toBeNull();
        expect(Number(l![1]), `${name}.cScale${i} lightness`).toBeGreaterThan(15);
      }
    }
  });

  it('keeps mindmap section fills readable against their label colour', () => {
    // Labels come from cScaleLabel{i}, which mermaid derives from textColor:
    // #1c2024 in light, #e2e8f0 in dark. Sections must contrast with that.
    for (const name of ['light', 'dark'] as const) {
      const wantDarkFill = name === 'dark';
      for (let i = 0; i < 12; i++) {
        const l = Number(
          MERMAID_THEMES[name][`cScale${i}`].match(/,\s*([\d.]+)%\)/)![1],
        );
        if (wantDarkFill) expect(l, `dark.cScale${i}`).toBeLessThan(45);
        else expect(l, `light.cScale${i}`).toBeGreaterThan(55);
      }
    }
  });

  it('sets mainBkg and nodeBorder so class/ER/mindmap inherit the palette', () => {
    for (const name of ['light', 'dark'] as const) {
      expect(MERMAID_THEMES[name].mainBkg).toBeTruthy();
      expect(MERMAID_THEMES[name].nodeBorder).toBeTruthy();
    }
  });

  it('preserves the antiscript security level and carries no palette itself', () => {
    expect(MERMAID_BASE_CONFIG.securityLevel).toBe('antiscript');
    expect(MERMAID_BASE_CONFIG.startOnLoad).toBe(false);
    expect('themeVariables' in MERMAID_BASE_CONFIG).toBe(false);
  });
});
