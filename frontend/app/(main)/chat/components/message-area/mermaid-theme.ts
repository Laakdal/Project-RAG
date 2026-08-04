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

/**
 * Hues for the DATA diagrams — pie slices and xychart plots.
 *
 * The `SECTIONS` series above cannot be reused here. It exists to reproduce
 * mermaid's own derived mindmap colours byte-for-byte, so three of its twelve
 * entries sit within 2° of each other (150/150/152) and differ only in
 * saturation. Branches of a mindmap can carry that — they are labelled and
 * spatially separated — but adjacent pie slices touch, so two low-saturation
 * near-jades read as one wedge.
 *
 * These are spaced 40° apart instead, starting from the jade the rest of the UI
 * is built on, so slice 1 stays on-brand and every neighbour is unmistakably
 * different.
 */
const CHART_HUES = [152, 182, 212, 242, 272, 302, 332, 2, 32, 62, 92, 122] as const;

/**
 * Tones for the two data series.
 *
 * The constraints pull in opposite directions, which is why these are not one
 * palette:
 *
 * - PIE carries its percentage label ON the slice, so every slice must clear
 *   4.5:1 against `pieSectionTextColor`. Twelve slices that are all dark enough
 *   for near-white labels cannot also stay far enough apart from one another —
 *   a search over the whole hsl space returns no solution. Bright slices with
 *   DARK labels is the only combination that satisfies both, and it satisfies
 *   them identically in light and dark mode, so pie uses one series for both.
 *   `l` alternates by `delta` so neighbouring wedges differ in lightness as
 *   well as hue.
 * - BAR carries no text, so it has no label-contrast constraint at all. What it
 *   needs instead is to stand out from the PAGE — and the page is white in one
 *   mode and near-black in the other. So bars, unlike slices, must flip.
 */
const PIE_TONE = { s: 62, l: 78, delta: -10 } as const;
const BAR_TONE = {
  light: { s: 62, l: 38, delta: -8 },
  dark: { s: 62, l: 78, delta: -10 },
} as const;

/** hsl → #rrggbb. mermaid splits `plotColorPalette` on ',', which shatters any
 *  `hsl(h, s%, l%)` value into three unusable fragments, so every chart colour
 *  has to reach mermaid comma-free. */
function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (n: number) =>
    Math.round(255 * f(n))
      .toString(16)
      .padStart(2, '0');
  return `#${hex(0)}${hex(8)}${hex(4)}`;
}

/** The chart series as hex, in mermaid's `pie1..pieN` order. */
function chartSeries(tone: { s: number; l: number; delta: number }): string[] {
  return CHART_HUES.map((h, i) => hslToHex(h, tone.s, tone.l + (i % 2 ? tone.delta : 0)));
}

/**
 * Pie slice colours plus the surrounding text/stroke colours.
 *
 * `pieOpacity` is pinned to 1 because mermaid defaults it to 0.7 — at that
 * opacity the rendered slice is a blend of the palette colour and whatever sits
 * behind it, so the contrast guaranteed against `pieSectionTextColor` would not
 * be the contrast actually on screen.
 */
function pieScale(mode: 'light' | 'dark'): Record<string, string> {
  const out: Record<string, string> = {};
  chartSeries(PIE_TONE).forEach((hex, i) => {
    out[`pie${i + 1}`] = hex;
  });

  // Section labels sit ON a slice, so they stay dark in BOTH modes. Title and
  // legend sit on the page, so they follow the appearance.
  out.pieSectionTextColor = '#1c2024';
  const pageText = mode === 'light' ? '#1c2024' : '#e2e8f0';
  out.pieTitleTextColor = pageText;
  out.pieLegendTextColor = pageText;
  out.pieStrokeColor = mode === 'light' ? '#ffffff' : '#111113';
  out.pieOuterStrokeColor = mode === 'light' ? '#ffffff' : '#111113';
  out.pieStrokeWidth = '2px';
  out.pieOuterStrokeWidth = '2px';
  out.pieOpacity = '1';
  return out;
}

/** Theme for `xychart-beta`. mermaid reads these from a NESTED `xyChart` object,
 *  not from the flat variable namespace the other diagram types use. */
export interface XyChartPalette {
  backgroundColor: string;
  titleColor: string;
  xAxisLabelColor: string;
  xAxisTitleColor: string;
  xAxisTickColor: string;
  xAxisLineColor: string;
  yAxisLabelColor: string;
  yAxisTitleColor: string;
  yAxisTickColor: string;
  yAxisLineColor: string;
  plotColorPalette: string;
}

/**
 * `backgroundColor` is transparent so the chart sits on the chat surface.
 * mermaid's default is an opaque `#f4f4f4` card, which in dark mode reads as a
 * hole punched in the page.
 */
function xyChartScale(mode: 'light' | 'dark'): XyChartPalette {
  const text = mode === 'light' ? '#1c2024' : '#e2e8f0';
  const axis = mode === 'light' ? '#208368' : '#4cc38a';
  return {
    backgroundColor: 'transparent',
    titleColor: text,
    xAxisLabelColor: text,
    xAxisTitleColor: text,
    xAxisTickColor: axis,
    xAxisLineColor: axis,
    yAxisLabelColor: text,
    yAxisTitleColor: text,
    yAxisTickColor: axis,
    yAxisLineColor: axis,
    plotColorPalette: chartSeries(BAR_TONE[mode]).join(', '),
  };
}

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

/** A palette is flat string variables plus the one nested `xyChart` object. */
export type MermaidPalette = Record<string, string | XyChartPalette>;

export const MERMAID_THEMES: Record<'light' | 'dark', MermaidPalette> = {
  // Radix jade / olive on a light surface. Values match the pre-change render
  // exactly, including the two that mermaid previously derived for us
  // (mainBkg from primaryColor, edgeLabelBackground from secondaryColor).
  light: {
    ...sectionScale('light'),
    ...pieScale('light'),
    xyChart: xyChartScale('light'),
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
    ...pieScale('dark'),
    xyChart: xyChartScale('dark'),
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
