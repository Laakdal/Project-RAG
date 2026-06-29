# Mermaid Chat Diagrams — Design

**Date:** 2026-06-28
**Status:** Draft (awaiting review)

## Goal

Let the RAG assistant answer with **diagrams** — flowcharts, sequence diagrams,
state machines, and relationship diagrams — rendered inline in the chat. The
motivating case is the SISOP / OS-practicum corpus, where process flows, syscall
interactions, and process-state lifecycles are far clearer drawn than described.

Scope is **demo-grade**: get diagrams appearing reliably and looking like
Project RAG, with the smallest possible change surface.

## Key finding: the renderer already exists

The frontend already contains a complete, production-grade Mermaid renderer
(`frontend/app/(main)/chat/components/message-area/mermaid-diagram.tsx`),
inherited from the upstream fork and still wired into the live answer path:

- `answer-content.tsx` (the active renderer, used at `chat-response.tsx:285`)
  detects a ` ```mermaid ` fenced block in its `pre` handler (line ~857) and
  renders it via `<MermaidDiagram>`.
- `mermaid@^11.15.0`, `react-markdown`, `remark-gfm` are already installed.
- `MermaidDiagram` already handles: lazy-loading mermaid, **streaming-safe**
  rendering (400 ms debounce), **auto-repair** of broken source (dangling
  arrows, unclosed blocks), a dark-mode style injector, an **error banner**
  with "show source", and a **fullscreen** dialog with zoom + copy-as-PNG.

**Implication:** this is not a build-from-scratch task. The renderer is done;
the only thing missing is that the n8n RAG model never *emits* a `mermaid`
block. Make it emit one → diagrams appear. The work is therefore (1) a prompt
change in n8n and (2) a small branding/theming tweak to the existing component.

## Out of scope (explicitly NOT building)

- **No** code-execution sandbox, **no** generated-file artifacts, **no** blob
  storage, **no** artifact-streaming. (Those are the path for *real data charts*
  — matplotlib-style quantitative plots — which we are deliberately not doing.
  Mermaid covers *structural* diagrams only: structure → Mermaid, data → sandbox.)
- **No** Express backend changes, **no** DB/schema changes, **no** new npm deps.
- **No** CSV-table or inline-image prompt changes (the renderer supports both,
  but they are not requested here).
- **No** model routing changes — the existing answer model (`glm-4.6`) stays.

## Decisions (locked with the user)

1. **Trigger = Hybrid.** Always emit a diagram when the user explicitly asks
   (draw / diagram / visualize / flowchart / "show me"); *proactively* emit one
   when the answer describes a process, algorithm, step sequence, state machine,
   or set of relationships that is clearly clearer as a diagram. Otherwise none.
2. **Differentiation = Custom theme + branding tweak.** Recolor diagrams to
   Project RAG's jade accent, remove the one literal upstream fingerprint, and
   add a small caption — so diagrams read as a deliberate, branded feature.

## Architecture

Two change sites, no new components.

```
question
  → backend /chat (unchanged)
  → n8n "RAG Query" workflow  ← CHANGE 1: answer-synthesis prompt may now emit ```mermaid
  → SSE stream back (unchanged)
  → AnswerContent  (pre handler detects language-mermaid)
  → <MermaidDiagram>  ← CHANGE 2: branded theme + caption
  → branded inline SVG, expandable to fullscreen
```

The diagram travels as ordinary markdown in the answer text — the **inline
markdown** path — not as an artifact. That is why no backend/storage work is
needed.

### Change 1 — n8n RAG Query answer prompt (the feed)

**Where:** the `RAG Query` workflow (id `H4WL7om1JO3UmavC`), the answer-synthesis
LLM node's system prompt. (First implementation step: locate the exact node that
synthesizes the final answer and identify its system-prompt parameter.)

**Edit rule:** the workflow MUST be **closed in the n8n editor** before editing
via MCP (the editor's save silently overwrites API edits — see the
`qdrant-vector-name-mismatch` history).

**Append this guidance to the answer prompt** (wording may be tuned during
implementation; intent is fixed):

> **Diagrams.** When a process, algorithm, sequence of steps, state machine, or
> set of relationships would be clearer drawn — or whenever the user asks you to
> draw / diagram / visualize / flowchart something — include exactly one Mermaid
> diagram in a ` ```mermaid ` fenced code block, **in addition to** a short text
> explanation (never instead of it). Do not add a diagram for plain factual or
> conversational answers.
>
> Rules: use valid Mermaid v11 syntax; keep it focused (≤ ~15 nodes); prefer
> `flowchart`, `sequenceDiagram`, or `stateDiagram-v2`. Do not put markdown
> links or `@` characters inside node labels. Keep node text short.
>
> Example (process flow):
> ```mermaid
> flowchart TD
>     A[Process requests resource] --> B{Available?}
>     B -->|Yes| C[Allocate and continue]
>     B -->|No| D[Block process]
>     D --> E[Wait in queue]
> ```
>
> Example (state machine):
> ```mermaid
> stateDiagram-v2
>     [*] --> Ready
>     Ready --> Running: scheduled
>     Running --> Blocked: I/O wait
>     Blocked --> Ready: I/O done
>     Running --> [*]: exit
> ```

The two few-shot examples anchor correct syntax for the answer model
(`glm-4.6`). It rarely emits invalid Mermaid, and the frontend error banner
covers any misses — the examples are insurance.

### Change 2 — branded theming tweak (`mermaid-diagram.tsx`)

One file. Three small edits; everything else (streaming debounce, auto-repair,
error banner, fullscreen/zoom/copy) is untouched.

1. **Brand theme.** In `ensureInit()`, change `theme: 'default'` to
   `theme: 'base'` and supply `themeVariables` in Project RAG's jade palette.
   This keeps the existing "render with a fixed light theme; fix dark-mode
   legibility via SVG style injection" approach — only the colors change.
   Concrete starting values (Radix jade / olive, light base; tune in review):

   ```ts
   mermaid.initialize({
     startOnLoad: false,
     theme: 'base',
     securityLevel: 'antiscript',
     fontFamily: 'inherit',
     themeVariables: {
       primaryColor:       '#e7f6ef', // jade-3-ish node fill
       primaryBorderColor: '#29a383', // jade-9 node border
       primaryTextColor:   '#1c2024', // olive-12 text on light node
       lineColor:          '#208368', // jade-11 edges
       secondaryColor:     '#f1f5f3', // neutral secondary fill
       tertiaryColor:      '#fbfdfc', // near-white tertiary fill
     },
   });
   ```

2. **Remove the upstream fingerprint.** Rename the injected dark-edge style id
   `ph-dark-edges` → `rag-diagram-dark` (the only literal upstream marker that
   reaches the DOM). Pure string change in `injectDarkEdgeStyles()`.

3. **Branded caption.** Add a small "Diagram" label (with the existing
   `MaterialIcon` set) to the inline toolbar row (the `justify="end"` Flex shown
   once `inlineSvg` is ready) so the block reads as an intentional feature.

**Dark-mode coherence check:** with a `base` theme, the dark-edge injector still
forces `DARK_EDGE_COLOR` on edges and `DARK_TEXT_COLOR` on labels for legibility
on the dark container — unchanged and still correct. Verify node fills (light
jade tint) keep readable dark text in dark mode; the container background is a
light slate, so this matches the component's existing assumption.

## Error & edge handling (already provided by the component)

- **Invalid syntax** from the model → `normalizeMermaid` + `sanitizeMermaid`
  attempt repair; on hard failure the amber "Could not render diagram" banner
  shows with a copyable source view. The answer text is never broken.
- **Mid-stream partial** diagram → 400 ms debounce keeps a spinner until the
  source stabilizes.
- **Over-eager diagrams** → dialed back by tightening the prompt's "when to
  diagram" guidance; no code change needed.

## Verification

**n8n (integration-style — n8n flows are not unit-testable; this is the accepted
trade-off for keeping the change in the prompt):**
- Explicit ask: "draw a flowchart of the producer–consumer algorithm" → a
  flowchart renders inline.
- Proactive: a process/state question (e.g. "explain the process state
  lifecycle") → a diagram appears alongside the text.
- Negative: a plain factual question ("what is a semaphore?") → **no** diagram
  (confirm it does not spam diagrams onto every answer).
- Resilience: a deliberately malformed/oversized case → the error banner
  degrades cleanly with the source visible.

**Frontend:**
- `cd frontend && npx tsc --noEmit` exits 0; `npm run lint` clean.
- Manual (no React test harness exists): branded jade colors render in **light
  and dark**; the caption shows; fullscreen, zoom, and copy-as-PNG still work;
  the renamed `rag-diagram-dark` id is present and `ph-dark-edges` is gone.

## File summary

| File | Change |
|---|---|
| n8n `RAG Query` (`H4WL7om1JO3UmavC`) | Append diagram guidance + 2 few-shot examples to the answer-synthesis prompt (editor closed during edit) |
| `frontend/app/(main)/chat/components/message-area/mermaid-diagram.tsx` | `theme: 'base'` + jade `themeVariables`; rename `ph-dark-edges` → `rag-diagram-dark`; add a "Diagram" caption to the inline toolbar |

## Commit / style constraints

- Plain one-line commit messages, no conventional-commit prefixes, no
  attribution lines, and do not name the upstream project in commit messages.
- App is branded "Project RAG"; inline English literals only (no i18n).
- The n8n change is applied via the editor/MCP, not git.
