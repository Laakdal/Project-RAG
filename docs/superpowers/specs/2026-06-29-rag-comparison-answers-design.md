# RAG Comparison Answers — Design

**Date:** 2026-06-29
**Status:** Draft (awaiting review)

## Goal

Let the RAG assistant give **structured, document-grounded comparisons with a
recommendation** when the user asks a "which is better / which should I pick"
question — e.g. *"which laptop is better, A or B?"*, *"should we use vendor X or
Y?"*, *"compare these two policies"*. The answer presents a comparison **table**
of the relevant factors found in the retrieved documents, plus a clear
**verdict** with a short justification and citations.

This is the deliberately lightweight first step toward a decision-support
capability. It is **not** a full SPK/DSS: there is no criteria/weights form and
no scoring method (SAW/TOPSIS). The recommendation is the LLM's grounded
opinion, structured for clarity. (See *Future extension* for the path to a real
method-backed DSS.)

## Key finding: this is a prompt change, not a new pipeline

Answer text is produced in two places, and both are just prompts:

- **Default path (most queries):** the n8n **"Generate Answer"** node prompt
  (lives in n8n, model `glm-4.6`; not in git).
- **Library / LangChain path:** `backend/src-langchain/query/nodes/generate.ts`,
  whose system prompt is currently the single line *"Answer the question using
  only the provided context. Be concise."* This node is shared by the library
  query (`src-langchain/library/query.ts`) and the LangChain provider path.

The frontend already renders markdown tables (react-markdown + remark-gfm), so
**no frontend change is needed**. The work is: upgrade both prompts.

## Behavior

The generation prompt gains comparison-aware behavior:

1. **Comparison/decision question** ("which is better", "X vs Y", "should I pick
   A or B", "compare …"):
   - One-line framing of what is being compared.
   - A **comparison table**: `Factor | Option A | Option B`, populated **only**
     with factors actually present in the retrieved context. Each populated cell
     carries a citation marker (`[1]`, `[2]`, …) matching the existing sources.
   - A **recommendation** line — **"Recommendation: <option>"** — with a 1–2
     sentence justification that references the tabulated factors.
   - A **caveat** line when the documents do not cover a relevant factor
     (e.g. *"Note: warranty terms were not found in the documents."*).
2. **Normal (non-comparison) question:** behavior unchanged — concise,
   context-grounded answer.
3. **Comparison with no document basis** (general knowledge only): still give an
   opinion, but **explicitly flag** that it is general knowledge, not drawn from
   the user's documents.

### Guardrail

The model may only tabulate factors that appear in the provided context. It must
**never invent values**. A missing factor is reported as missing, not filled in.
This keeps the feature honest and citation-backed.

## Components changed

| Component | Change | In git? |
|---|---|---|
| `backend/src-langchain/query/nodes/generate.ts` | Expand the system prompt with the comparison structure + guardrail; keep the concise default for non-comparison questions. | Yes — unit-testable |
| n8n "Generate Answer" node | Mirror the same instructions in the live prompt (model `glm-4.6`). | No — edited in n8n |
| Frontend | None (markdown tables already render). | — |

Both prompts must stay in sync; the spec text is the single source of truth for
the wording so the two paths behave identically.

## Data flow (unchanged)

```
question → retrieve (Qdrant) → context docs → generate (prompt) → answer + sources
```

Only the `generate` step's prompt changes. Retrieval, citations, and the
`{ answer, sources }` contract are untouched.

## Out of scope (explicitly NOT building)

- No criteria/weights input UI or form.
- No scoring method (SAW / TOPSIS / AHP), no decision matrix math.
- No sensitivity analysis, validation view, decision history, or export.
- No dedicated "Decisions" page — comparisons render inline in chat.
- No comparison-intent classifier service — the generation prompt decides format
  from the question itself.

## Testing

- Unit test `generate.ts` asserting the upgraded system prompt contains the
  comparison-structure guidance and the "only use factors present in context"
  guardrail. (We test prompt construction, not the LLM's wording, since output
  is model-dependent — consistent with the existing `generate.test.ts` approach
  of mocking the chat model.)
- Manual check: a comparison question over a known document returns a table +
  "Recommendation:" line with citation markers; a general question is unchanged.

## Future extension (not now)

If this graduates into a real **IDSS**: keep RAG as the *data* layer (extract the
factor values from documents into a decision matrix), add a **criteria/weights**
confirmation step (the guided-picker UX), and put a named **MCDM method**
(SAW first, optionally TOPSIS for comparison) underneath to produce a
reproducible, defensible ranking. That is a separate spec.
