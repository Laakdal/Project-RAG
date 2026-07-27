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

export const MERMAID_THEMES: Record<'light' | 'dark', Record<string, string>> = {
  // Radix jade / olive on a light surface. Values match the pre-change render
  // exactly, including the two that mermaid previously derived for us
  // (mainBkg from primaryColor, edgeLabelBackground from secondaryColor).
  light: {
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
