/**
 * Mermaid rendering config and per-appearance palettes.
 *
 * Diagrams are rendered with mermaid's 'base' theme plus Project RAG's jade
 * themeVariables. There is one palette per appearance and the correct one is
 * applied BEFORE each render — diagrams are never re-coloured after the fact.
 *
 * Both palettes MUST define the same keys, so no diagram type can fall through
 * to a mermaid default in one theme but not the other.
 */

/** Config shared by both themes. Never carries a palette — callers add one. */
export const MERMAID_BASE_CONFIG = {
  startOnLoad: false,
  theme: 'base',
  // Required: answer-content.security.test.tsx depends on this.
  securityLevel: 'antiscript',
  fontFamily: 'inherit',
} as const;

/**
 * Section colours for the diagrams that colour-code branches — mindmap above
 * all, plus timeline, journey and kanban. mermaid styles `.section-{i-1}` from
 * `cScale{i}`, so `cScale0` is the mindmap's root node.
 *
 * These have to be pinned per appearance because mermaid derives the series by
 * REDUCING lightness from the palette's base colours — an assumption that only
 * holds for a light base. Handed the dark palette it produced `hsl(H, S%, 0%)`
 * for all twelve: pure black nodes on a near-black surface, with the root
 * rendering as a black hole.
 *
 * Hue and saturation below are mermaid's own derived values, so light is
 * byte-identical to what it produced before. Only lightness changes for dark.
 * `cScaleLabel{i}` is deliberately NOT pinned — mermaid derives it from
 * `textColor`, which already resolves correctly in both modes.
 */
const SECTIONS: ReadonlyArray<{ h: number; s: number; light: number }> = [
  { h: 152, s: 45.4545454545, light: 68.5294117647 }, // cScale0 — mindmap root
  { h: 150, s: 16.6666666667, light: 70.2941176471 },
  { h: 150, s: 33.3333333333, light: 73.8235294118 },
  { h: 182, s: 45.4545454545, light: 68.5294117647 },
  { h: 212, s: 45.4545454545, light: 68.5294117647 },
  { h: 242, s: 45.4545454545, light: 68.5294117647 },
  { h: 272, s: 45.4545454545, light: 68.5294117647 },
  { h: 302, s: 45.4545454545, light: 68.5294117647 },
  { h: 2, s: 45.4545454545, light: 75 },
  { h: 62, s: 45.4545454545, light: 68.5294117647 },
  { h: 92, s: 45.4545454545, light: 68.5294117647 },
  { h: 122, s: 45.4545454545, light: 68.5294117647 },
];

/**
 * Lightness for every dark section. Deep enough to sit on the dark surface,
 * light enough that #e2e8f0 labels clear 4.5:1 — differentiation between
 * branches comes from hue, exactly as it does in light mode.
 */
const DARK_SECTION_LIGHTNESS = 28;

function sectionScale(mode: 'light' | 'dark'): Record<string, string> {
  const out: Record<string, string> = {};
  SECTIONS.forEach((c, i) => {
    const l = mode === 'light' ? c.light : DARK_SECTION_LIGHTNESS;
    out[`cScale${i}`] = `hsl(${c.h}, ${c.s}%, ${l}%)`;
  });

  // The mindmap ROOT node carries both `section-root` and `section--1`, and
  // mermaid emits the `.section-root` rule after the `.section--1` one at equal
  // specificity — so `.section-root` wins. It is filled from `git0`, the
  // gitGraph branch colour, NOT from the cScale series. Pinning only cScale
  // therefore left the root a black hole while every other node was fixed.
  // Light derives git0 to exactly its cScale0, so matching them keeps light
  // unchanged and gives dark a root that matches its first branch.
  out.git0 = out.cScale0;
  return out;
}

export const MERMAID_THEMES: Record<'light' | 'dark', Record<string, string>> = {
  // Radix jade / olive on a light surface. Values match the pre-change render
  // exactly, including the two that mermaid previously derived for us
  // (mainBkg from primaryColor, edgeLabelBackground from secondaryColor).
  light: {
    ...sectionScale('light'),
    primaryColor: '#e7f6ef',
    primaryBorderColor: '#29a383',
    primaryTextColor: '#1c2024',
    textColor: '#1c2024',
    lineColor: '#208368',
    secondaryColor: '#f1f5f3',
    tertiaryColor: '#fbfdfc',
    mainBkg: '#e7f6ef',
    nodeBorder: '#29a383',
    edgeLabelBackground: '#f1f5f3',
    // ER attribute rows. Pinned to the values mermaid derived before these
    // palettes existed — lighten(mainBkg, 75) and lighten(mainBkg, 5) — so
    // light mode is unchanged.
    rowOdd: '#ffffff',
    rowEven: '#fafdfb',
  },
  // The same jade identity inverted onto a dark surface.
  dark: {
    ...sectionScale('dark'),
    primaryColor: '#0c2a22',
    primaryBorderColor: '#29a383',
    primaryTextColor: '#e2e8f0',
    textColor: '#e2e8f0',
    lineColor: '#4cc38a',
    secondaryColor: '#16211c',
    tertiaryColor: '#111113',
    mainBkg: '#0c2a22',
    nodeBorder: '#29a383',
    edgeLabelBackground: '#16211c',
    // ER attribute rows. mermaid 11's erBox reads these two names only — the
    // documented `attributeBackgroundColor*` aliases are never consulted.
    // Without them rowOdd becomes lighten(mainBkg, 75) = a near-white jade,
    // and every attribute vanishes against the light text.
    rowOdd: '#0c2a22',
    rowEven: '#123e32',
  },
};
