# Mermaid Light/Dark Palettes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render chat diagrams with a palette that matches the active theme, replacing the post-render `!important` CSS patch layer that leaves flowchart and ER edge labels unreadable in dark mode.

**Architecture:** A new `mermaid-theme.ts` module owns the base mermaid config plus one theme-variable palette per appearance. `mermaid-diagram.tsx` reads the app's `useThemeAppearance()` hook, calls `mermaid.initialize` with the matching palette immediately before every render, and re-renders when the theme flips. The PNG export path re-renders with the light palette so Copy Image is identical in both themes.

**Tech Stack:** Next.js (App Router), React 18, TypeScript, Radix Themes, mermaid 11.15.0, vitest + @testing-library/react, jsdom.

## Global Constraints

- Work on branch `vps-frontend`. All paths below are relative to the repo root.
- All files live under `frontend/`. Run every command from `frontend/`.
- `securityLevel: 'antiscript'` MUST be preserved in the mermaid config — `answer-content.security.test.tsx` depends on mermaid not executing script content.
- `normalizeMermaid()` and `sanitizeMermaid()` are OUT OF SCOPE. Do not change their behavior.
- Do not change light-mode appearance. The light palette values must stay byte-identical to today's rendered result.
- Existing tests `mermaid-diagram.broken.test.tsx` and `mermaid-diagram.uml-participants.test.ts` must stay green after every task.
- New test files under `frontend/app/(main)/chat/components/message-area/__tests__/` are covered by an uncommitted `.gitignore` rule and need `git add -f` to commit.
- Test command: `npx vitest run <path>` from `frontend/`.

---

### Task 1: Theme palette module

**Files:**
- Create: `frontend/app/(main)/chat/components/message-area/mermaid-theme.ts`
- Test: `frontend/app/(main)/chat/components/message-area/__tests__/mermaid-theme.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `MERMAID_BASE_CONFIG` (object literal, no `themeVariables` key) and `MERMAID_THEMES: Record<'light' | 'dark', Record<string, string>>`. Task 2 and Task 3 import both from `'./mermaid-theme'`.

- [ ] **Step 1: Write the failing test**

Create `frontend/app/(main)/chat/components/message-area/__tests__/mermaid-theme.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run from `frontend/`: `npx vitest run "app/(main)/chat/components/message-area/__tests__/mermaid-theme.test.ts"`
Expected: FAIL at collection — `Failed to resolve import "../mermaid-theme"`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/app/(main)/chat/components/message-area/mermaid-theme.ts`:

```ts
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
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run from `frontend/`: `npx vitest run "app/(main)/chat/components/message-area/__tests__/mermaid-theme.test.ts"`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/\(main\)/chat/components/message-area/mermaid-theme.ts
git add -f frontend/app/\(main\)/chat/components/message-area/__tests__/mermaid-theme.test.ts
git commit -m "add per-appearance mermaid palettes"
```

---

### Task 2: Render with the active theme

**Files:**
- Modify: `frontend/app/(main)/chat/components/message-area/mermaid-diagram.tsx` — delete lines 17-65 (`readDarkMode`, `useDarkMode`), delete `injectDarkEdgeStyles` and its two constants (lines ~325-410), rewrite `ensureInit` (lines 67-98), update the component body.
- Test: `frontend/app/(main)/chat/components/message-area/__tests__/mermaid-theme-applied.test.tsx`

**Interfaces:**
- Consumes: `MERMAID_BASE_CONFIG`, `MERMAID_THEMES` from `'./mermaid-theme'` (Task 1); `useThemeAppearance()` from `'@/app/components/theme-provider'`, which returns `{ appearance: 'light' | 'dark'; preference; setPreference }`.
- Produces: `applyTheme(appearance: 'light' | 'dark'): Promise<void>` — module-private. Task 3 relies on `applyTheme` existing and on `MermaidDiagram` still exporting unchanged.

- [ ] **Step 1: Write the failing test**

Create `frontend/app/(main)/chat/components/message-area/__tests__/mermaid-theme-applied.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run from `frontend/`: `npx vitest run "app/(main)/chat/components/message-area/__tests__/mermaid-theme-applied.test.tsx"`
Expected: FAIL — the dark case reports `themeVariables` equal to the light jade values (the component currently hard-codes one palette), and the third case finds `rag-diagram-dark` in the markup.

- [ ] **Step 3: Write minimal implementation**

In `mermaid-diagram.tsx`:

3a. Add the imports (top of file, after the existing Radix import):

```tsx
import { useThemeAppearance } from '@/app/components/theme-provider';
import { MERMAID_BASE_CONFIG, MERMAID_THEMES } from './mermaid-theme';
```

3b. Delete the whole "Dark-mode detection" section — the `readDarkMode` and `useDarkMode` functions and their doc comment (lines 17-65).

3c. Replace the "Mermaid initialisation (singleton)" section (lines 67-98) with:

```tsx
// ─── Mermaid initialisation ─────────────────────────────────────────────────

/**
 * Apply the palette for `appearance` before rendering.
 *
 * mermaid.initialize() is global and idempotent, so it is called before every
 * render rather than once: correctness now depends on the active config
 * matching the theme the diagram is about to be drawn in. Skipping the call
 * when the theme has not changed would be a false economy — a diagram
 * rendered after an export (which re-applies the light palette) would come out
 * with the wrong colours.
 */
async function applyTheme(appearance: 'light' | 'dark'): Promise<void> {
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({
    ...MERMAID_BASE_CONFIG,
    themeVariables: MERMAID_THEMES[appearance],
  });
}
```

3d. Delete the whole "Dark-mode overlay" section — `DARK_EDGE_COLOR`, `DARK_TEXT_COLOR` and `injectDarkEdgeStyles` (lines ~325-410).

3e. In the component body, replace `const isDark = useDarkMode();` with:

```tsx
const { appearance } = useThemeAppearance();
```

3f. Delete the two `displayInlineSvg` / `displayFullscreenSvg` lines and use the
plain values at both call sites — `dangerouslySetInnerHTML={{ __html: inlineSvg ?? '' }}`
for the inline view and `__html: responsiveSvg ?? ''` for the fullscreen view.

3g. In the render effect, replace `await ensureInit();` with `await applyTheme(appearance);`
and add `appearance` to the dependency array:

```tsx
  }, [chart, appearance]);
```

- [ ] **Step 4: Run test to verify it passes**

Run from `frontend/`: `npx vitest run "app/(main)/chat/components/message-area/__tests__/mermaid-theme-applied.test.tsx"`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run the neighbouring mermaid tests**

Run from `frontend/`: `npx vitest run "app/(main)/chat/components/message-area/__tests__/mermaid-diagram.broken.test.tsx" "app/(main)/chat/components/message-area/__tests__/mermaid-diagram.uml-participants.test.ts"`
Expected: PASS. `mermaid-diagram.broken.test.tsx` renders without a ThemeProvider — `useThemeAppearance()` returns the context default `appearance: 'light'`, so it must still show the error banner.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/\(main\)/chat/components/message-area/mermaid-diagram.tsx
git add -f frontend/app/\(main\)/chat/components/message-area/__tests__/mermaid-theme-applied.test.tsx
git commit -m "render diagrams with the active theme palette"
```

---

### Task 3: Keep PNG export light

**Files:**
- Modify: `frontend/app/(main)/chat/components/message-area/mermaid-diagram.tsx` — `svgToPngBlob` and `handleCopyImage`.
- Test: `frontend/app/(main)/chat/components/message-area/__tests__/mermaid-export-light.test.tsx`

**Interfaces:**
- Consumes: `applyTheme` and the palettes from Task 2.
- Produces: `renderLightSvg(chart: string, id: string): Promise<string | null>` — module-private; returns the light-themed SVG string, or `null` when the source cannot be re-rendered.

Copy Image rasterizes onto a forced white background. After Task 2 a dark-mode
diagram has light text, so exporting the on-screen SVG would produce near-white
text on white. The export therefore re-renders from source with the light
palette.

- [ ] **Step 1: Write the failing test**

Create `frontend/app/(main)/chat/components/message-area/__tests__/mermaid-export-light.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run from `frontend/`: `npx vitest run "app/(main)/chat/components/message-area/__tests__/mermaid-export-light.test.tsx"`
Expected: FAIL — `initialize` is not called again on click, because the export currently reuses the on-screen (dark) SVG.

- [ ] **Step 3: Write minimal implementation**

3a. Add `renderLightSvg` immediately above `svgToPngBlob`:

```tsx
/**
 * Re-render `chart` with the LIGHT palette for export.
 *
 * Mirrors the two-pass strategy of the on-screen render: normalised source
 * first, repaired source second. Returns null if both fail, so the caller can
 * fall back to the on-screen SVG rather than losing the export entirely.
 */
async function renderLightSvg(chart: string, id: string): Promise<string | null> {
  await applyTheme('light');
  const { default: mermaid } = await import('mermaid');

  const normalised = normalizeMermaid(chart);
  try {
    return (await mermaid.render(id, normalised)).svg;
  } catch {
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
  }

  const { result: repaired, changed } = sanitizeMermaid(normalised);
  if (!changed) return null;
  try {
    return (await mermaid.render(`${id}r`, repaired)).svg;
  } catch {
    document.getElementById(`${id}r`)?.remove();
    document.getElementById(`d${id}r`)?.remove();
    return null;
  }
}
```

3b. In `handleCopyImage`, replace the `blob = await svgToPngBlob(svgContent);` line with:

```tsx
    try {
      const lightSvg = await renderLightSvg(chart, `${containerId}x`);
      blob = await svgToPngBlob(lightSvg ?? svgContent);
    } catch {
      flash(false);
      return;
    }
```

3c. Add `chart` and `containerId` to the `useCallback` dependency array:

```tsx
  }, [svgContent, chart, containerId, flash]);
```

3d. After an export the global mermaid config is light. The render effect calls
`applyTheme(appearance)` before every render, so the next diagram render
restores the correct palette — no extra bookkeeping needed. Add this comment
above the `renderLightSvg` call in `handleCopyImage`:

```tsx
    // Leaves the global mermaid config on the light palette; the render effect
    // re-applies the active theme before the next draw.
```

- [ ] **Step 4: Run test to verify it passes**

Run from `frontend/`: `npx vitest run "app/(main)/chat/components/message-area/__tests__/mermaid-export-light.test.tsx"`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/\(main\)/chat/components/message-area/mermaid-diagram.tsx
git add -f frontend/app/\(main\)/chat/components/message-area/__tests__/mermaid-export-light.test.tsx
git commit -m "export diagrams with the light palette"
```

---

### Task 4: Full suite, build, deploy and visual verification

**Files:**
- No source changes expected. Fix-ups only if a check fails.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: a deployed `rag_frontend` and before/after screenshots.

- [ ] **Step 1: Run the whole frontend test suite**

Run from `frontend/`: `npx vitest run`
Expected: PASS. No test may regress; `parse-download-markers.test.ts` and `use-chat-speech.test.ts` stay excluded by `vitest.config.ts`.

- [ ] **Step 2: Type-check and build**

Run from `frontend/`: `npx tsc --noEmit` then `npm run build`
Expected: both succeed. A failure here almost certainly means a leftover reference to the deleted `useDarkMode`, `isDark`, `injectDarkEdgeStyles`, `displayInlineSvg`, or `displayFullscreenSvg`.

- [ ] **Step 3: Push and rebuild the container**

```bash
git push origin vps-frontend
```

Then on the VPS (`ssh vps`), in `/opt/rag-skripsi-stack/rag-frontend`:

```bash
git pull --ff-only
docker compose up -d --build
```

`git pull --ff-only` preserves the local compose edit. The bundle bakes at
build time, so the rebuild is required for the change to appear on
ariorafa.site.

- [ ] **Step 4: Verify all five diagram types in both themes**

Open the existing test conversation on ariorafa.site
(`/chat/?conversationId=45ea2151-f8ac-4247-88e7-af4bf3c01d9d`), which already
holds one flowchart, sequence, mindmap, ER and class diagram. Toggle the theme
from the account menu (or set `localStorage['theme-preference']`) and check:

1. **Dark, flowchart** — the `Approved` / `Rejected` edge labels are light text on a dark background. This is the headline fix; it was light-on-light before.
2. **Dark, ER** — relationship labels readable; entity boxes jade-bordered, not bare black.
3. **Dark, mindmap** — branch text readable, nodes in the jade palette rather than mermaid's default blues.
4. **Dark, class and sequence** — node fills consistent with the flowchart, no black-on-black text.
5. **Light, all five** — unchanged from the baseline screenshots (`light-flowchart.png`, `light-class.png`, `light-er.png` at repo root).
6. **Copy Image in dark mode** — the exported PNG is a light diagram on white, fully legible.

- [ ] **Step 5: Commit any fix-ups and record the outcome**

If a diagram type still looks wrong, the cause is a mermaid variable the
palettes do not set (sequence actor text and mindmap section colours are the
likeliest). Add the missing key to BOTH palettes in `mermaid-theme.ts` — the
Task 1 test enforces symmetric key sets — then re-run Task 4 from Step 1.

```bash
git add frontend/app/\(main\)/chat/components/message-area/mermaid-theme.ts
git commit -m "add missing mermaid palette variables for <diagram type>"
```

---

## Follow-up (not part of this plan)

Port to `dev2` additively. `vps-frontend` and `dev2` have diverged in both
directions, so cherry-pick the commits rather than merging.
