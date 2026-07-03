# IDSS Brainstorming Cards — Design

**Date:** 2026-07-04
**Status:** Draft (awaiting review)

## Goal

Extend the IDSS capability from *"which is better"* comparison into **ideation**.
When the user asks a brainstorming-style question — *"brainstorm marketing
angles"*, *"what are my options here?"*, *"suggest approaches"*, *"give me ideas
for X"* — the assistant returns a **divergent list of distinct options as
interactive cards**: each a bold title + a one-line, document-grounded rationale.

The cards are actionable, not just decorative:

- **Single-select mode** — clicking a card sends a follow-up question that
  continues the chat (e.g. *"go deeper on Option A"*).
- **Multi-select mode** — the user checks several cards and hits **Compare
  selected**, which feeds them into the **existing comparison IDSS**
  (factor table + recommendation). Brainstorm → decide, in one loop.

The model chooses which mode fits the response. This is the ideation sibling of
[the comparison feature](2026-06-29-rag-comparison-answers-design.md) and, like
it, is deliberately lightweight — it is **not** a full SPK/DSS (no criteria
weights, no SAW/TOPSIS).

## Key finding: reuse the existing fenced-block render pipeline

The chat already has a proven **"model emits a fenced code block → frontend
renders a custom component"** path. Two features use it today, both in
`frontend/app/(main)/chat/components/message-area/answer-content.tsx`:

- ` ```mermaid ` → `MermaidDiagram` (`answer-content.tsx:857`)
- ` ```csv ` → a rendered table (`answer-content.tsx:866`)

The `pre` renderer sniffs the fenced block's `language-xxx` class and swaps in a
component. Brainstorming cards slot into this exact pattern with **one new
branch** and **one new component**.

The interaction primitive also already exists: `handleAskMoreClick` in
`message-list.tsx:1092` sends a follow-up user turn via
`threadRuntime.append({ role: 'user', content, startRun: true })`. The card
component calls the same primitive.

So this is a **prompt change + one renderer component** — no backend schema, SSE,
or message-store changes.

## Emission format

The Generate Answer prompt gains brainstorming behavior. For ideation questions,
the model ends its answer with a fenced block tagged `idss-options` containing a
single JSON object:

````
```idss-options
{
  "multiSelect": false,
  "prompt": "Which direction fits your goal?",
  "options": [
    {
      "label": "Option A",
      "description": "One-line rationale grounded in the documents [1].",
      "followup": "Go deeper on Option A"
    },
    {
      "label": "Option B",
      "description": "One-line rationale grounded in the documents [2].",
      "followup": "Go deeper on Option B"
    }
  ]
}
```
````

Field contract:

| Field | Type | Meaning |
|---|---|---|
| `multiSelect` | boolean | `false` → clickable single-pick follow-ups. `true` → checkboxes + "Compare selected". Model decides per response. |
| `prompt` | string | Short question shown above the cards (optional; card block still renders without it). |
| `options[].label` | string | Bold card title. |
| `options[].description` | string | One-line rationale; may carry citation markers (`[1]`) rendered like the rest of the answer. |
| `options[].followup` | string | (single-select only) The user turn appended when the card is clicked. Optional — falls back to `"Tell me more about: <label>"`. |

The model may still write normal prose **before** the block (framing sentence,
etc.); the cards come at the end.

### Guardrail

Options must be grounded in the retrieved context — the same honesty rule as the
comparison gate. The model does not invent options unsupported by the documents;
if it is drawing on general knowledge (no document basis), it says so in the
prose above the cards.

## Rendering

New component `idss-options.tsx` (sibling of `mermaid-diagram.tsx`).

- `answer-content.tsx`'s `pre` renderer gets one branch:
  `lang.includes('language-idss-options')` → parse the JSON child → render
  `<IdssOptions data={...} />`.
- **Defensive parsing.** The block can arrive partial mid-stream, or malformed.
  `JSON.parse` is wrapped in try/catch; on failure the component renders nothing
  (or, if the block is clearly still streaming, a lightweight skeleton) — it
  **never throws**. Only a well-formed object with a non-empty `options` array
  renders cards.
- **Styling** matches the app's Radix + jade theme (`Box`/`Flex`/`Text`,
  `var(--slate-*)` / `var(--accent-*)`), echoing the numbered-option layout: bold
  title, muted description, hover + selected states. Descriptions run through the
  same citation processing as answer text so `[1]` markers stay clickable.

## Interaction

`IdssOptions` uses `useThreadRuntime()` from `@assistant-ui/react` directly (it
is a client component, same as the rest of the message area).

- **Single-select (`multiSelect: false`):** clicking a card appends its
  `followup` (or the fallback) as a user turn and starts a run —
  `threadRuntime.append({ role: 'user', content: [{ type: 'text', text }], startRun: true })`.
  The conversation continues naturally.
- **Multi-select (`multiSelect: true`):** each card is a checkbox. A
  **"Compare selected"** button (disabled until ≥2 are checked) appends a
  comparison query — `"Compare these options: A, B, C — which is better?"` — which
  trips the **existing** comparison gate and returns the factor table +
  recommendation. This deliberately chains ideation into the comparison IDSS.

Cards are stateless beyond local selection: no persistence of which card was
clicked. The click simply produces an ordinary follow-up message, so history,
regenerate, and reload all behave normally.

## Trigger

**Phrasing-based**, consistent with the comparison gate — no UI toggle, no
request flag. The Generate Answer prompt recognises ideation intent
(*"brainstorm"*, *"give me ideas"*, *"what are my options"*, *"suggest
approaches"*, *"list some ways to …"*) and emits the `idss-options` block.
Non-ideation questions are unaffected.

## Components changed

| Component | Change | In git? |
|---|---|---|
| n8n **"Generate Answer"** node | Add brainstorming behavior + the `idss-options` block spec to the live prompt (model `glm-4.6`). This is what the deployed chat runs. | No — edited in n8n |
| `backend/src-langchain/query/nodes/generate.ts` | Mirror the same instructions in `SYSTEM_PROMPT` (the in-process LangChain copy). | Yes — unit-testable |
| `backend/src-langchain/query/nodes/generate.test.ts` | Add a case asserting the prompt carries the brainstorming/`idss-options` guidance + grounding guardrail. | Yes |
| `frontend/.../message-area/idss-options.tsx` (new) | Card renderer + interaction (single/multi-select, follow-up append, compare-selected). | Yes |
| `frontend/.../message-area/answer-content.tsx` | One new `pre` branch dispatching `language-idss-options` to `IdssOptions`. | Yes |

Both prompts must stay in sync; this spec's wording is the single source of
truth so the n8n and LangChain paths behave identically (same discipline noted in
`generate.ts:11-13`).

## Data flow (unchanged)

```
question → retrieve → context docs → generate (prompt) → answer text (may embed ```idss-options```)
         → frontend markdown render → pre branch → IdssOptions cards
         → card click / compare-selected → threadRuntime.append → next turn
```

The `{ answer, sources }` contract and retrieval are untouched — the options
block travels inside the existing `answer` string.

## Out of scope (explicitly NOT building)

- No composer "Brainstorm" toggle or mode button (phrasing-based only).
- No backend message-schema, SSE, or store changes — cards live inside `answer`.
- No persistence of card selections or a separate "ideas" artifact type.
- No criteria/weights UI or MCDM scoring — that stays in the comparison feature's
  future-extension path.
- No dedicated ideation intent-classifier service — the prompt decides format.

## Testing

- **Unit** — extend `generate.test.ts`: assert `SYSTEM_PROMPT` contains the
  brainstorming-structure guidance, the `idss-options` block contract, and the
  grounding guardrail (testing prompt construction, not LLM wording — consistent
  with the mocked-model approach already used there).
- **Renderer** — a small test / manual check that `IdssOptions` (a) renders cards
  from a valid JSON block, (b) renders nothing on malformed/partial JSON without
  throwing, (c) single-select click and (d) compare-selected each call
  `threadRuntime.append` with the expected text.
- **Manual E2E** — with a document loaded, ask *"brainstorm …"*: cards render;
  clicking one continues the chat; multi-select + "Compare selected" produces the
  comparison factor table.

## Future extension (not now)

If ideation graduates further: let the model attach lightweight pros/cons per
option, or thread selected ideas directly into a weighted decision matrix (the
comparison feature's MCDM future path). Both are separate specs.
