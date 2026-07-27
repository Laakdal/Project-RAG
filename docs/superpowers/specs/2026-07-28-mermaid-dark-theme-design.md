# Mermaid diagrams: real light and dark themes

**Date:** 2026-07-28
**Branch:** `vps-frontend`
**Scope:** frontend only — `frontend/app/(main)/chat/components/message-area/`

## Problem

Chat diagrams always render with a **light** jade mermaid palette. Dark mode is
faked afterwards by `injectDarkEdgeStyles()`, which splices a `<style>` block of
`!important` overrides into the finished SVG. This is wrong in three ways that
are visible on ariorafa.site today:

1. **Flowchart and ER edge labels are unreadable in dark mode.** The pale box
   behind `Approved` / `Rejected` is `background-color: #f1f5f3` on
   `span.edgeLabel`, which mermaid derives from the `edgeLabelBackground` theme
   variable. The existing override targets `.edgeLabel .label rect` — a rect
   that does not carry that background — so it never applied, while the
   companion rule *did* force the text light. Light text on a light box.
2. **Mindmap has no dark selectors at all.** It currently looks acceptable only
   because its nodes happen to be light-filled.
3. **Node fills are inconsistent between diagram types.** Class and ER nodes are
   transparent and go black in dark mode, while flowchart and sequence nodes
   stay light jade. Two diagrams in one conversation read as two design
   languages.

The component also re-implements dark-mode detection with its own
`MutationObserver` (`mermaid-diagram.tsx:19-65`) instead of using the app's
`ThemeProvider`, so there are two sources of truth for appearance.

## Approach

Render each diagram with a palette that matches the current theme, instead of
rendering light and patching. Chosen over the two lower-churn alternatives
(keep light diagrams everywhere; repair the existing overrides) because it
removes the patch layer rather than deepening it, and it makes all five diagram
types consistent for free — mermaid applies theme variables uniformly.

## Design

### New: `mermaid-theme.ts`

Exports `MERMAID_THEMES: Record<'light' | 'dark', Record<string, string>>`.

- **light** — today's values, unchanged: `primaryColor #e7f6ef`,
  `primaryBorderColor #29a383`, `primaryTextColor #1c2024`, `lineColor #208368`,
  `secondaryColor #f1f5f3`, `tertiaryColor #fbfdfc`.
- **dark** — the jade-on-dark parallel: `primaryColor #0c2a22`,
  `primaryBorderColor #29a383`, `primaryTextColor #e2e8f0`, `textColor #e2e8f0`,
  `lineColor #4cc38a`, `secondaryColor #16211c`, `tertiaryColor #111113`,
  `mainBkg #0c2a22`, `nodeBorder #29a383`, `edgeLabelBackground #16211c`.

`mainBkg` / `nodeBorder` are what pull class, ER and mindmap into the palette
instead of letting them fall through to mermaid defaults (defect 2 and 3).
`edgeLabelBackground` is what fixes the unreadable labels (defect 1).

Lives in its own module so the palette is unit-testable and the 1000-line
component file stops growing.

### Changed: `mermaid-diagram.tsx`

- Delete `readDarkMode()` and `useDarkMode()` (lines 19-65). Use
  `useThemeAppearance()` from `@/app/components/theme-provider` — one source of
  truth, no MutationObserver.
- Delete `injectDarkEdgeStyles()` and the `displayInlineSvg` /
  `displayFullscreenSvg` patch layer. ~60 lines of `!important` CSS goes away;
  the render effect's output is used directly.
- Replace the `ensureInit()` singleton with `applyTheme(appearance)`, which
  calls `mermaid.initialize({ ...base, themeVariables: MERMAID_THEMES[appearance] })`
  immediately before each render. `mermaid.initialize` is safe to call
  repeatedly; the singleton exists only to avoid redundant work, and correctness
  now depends on the config matching the current theme.
- Add `appearance` to the render effect's dependency array so a theme flip
  re-renders through the existing 400ms debounce.

### Changed: PNG export

`svgToPngBlob()` re-renders the chart with the **light** palette into a
throwaway render id before rasterizing onto its white background. Without this,
Copy Image in dark mode would produce light text on a white PNG. Export output
is therefore identical in both themes — which is what thesis screenshots want.

### Untouched

`normalizeMermaid()` and `sanitizeMermaid()` are pure syntax repair and are not
part of this change. The container background stays `var(--slate-2)`, which
already adapts.

## Testing

Existing `mermaid-diagram.broken.test.tsx` and
`mermaid-diagram.uml-participants.test.ts` must stay green.

New:

- `mermaid-theme.test.ts` — dark's `edgeLabelBackground` is dark and its
  `primaryTextColor` is light (the specific regression), and both palettes
  define the same key set so no variable is dark-only or light-only.
- A component test asserting `mermaid.initialize` receives the dark palette when
  `appearance` is `dark` and the light palette when it is `light` (mermaid
  mocked).

Manual: rebuild `rag_frontend`, then re-capture all five diagram types
(flowchart, sequence, mindmap, ER, class) in both themes and compare against the
pre-change baseline screenshots.

## Rollout

Frontend-only, on `vps-frontend`. The bundle bakes at build time, so this
requires a rebuild of the `rag_frontend` container to appear on ariorafa.site.
Port to `dev2` separately — the two branches have diverged both ways, so port
additively rather than merging.
