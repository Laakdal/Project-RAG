# Auto-detecting when a question needs decision support

## Problem

The chat can render interactive option cards from an ```idss-options block the answer
model emits. Today that block only appears when the answer model matches the question
against a phrase list in its own prompt ("brainstorm ...", "what are my options",
"which feature should I prioritise", "rank ..."), plus the DSS/SPK vocabulary added on
2026-07-27.

Two things are wrong with that:

1. **It is a permission, not an instruction.** The prompt says "You *may* write one short
   framing sentence, then output a fenced code block". Observed on the live dev stack: a
   question that explicitly asked for the feature produced cards while the document
   context was empty, and produced none once the same question was answered from an
   attached PDF. Nothing in the prompt suppresses the block when context is present — the
   grounding rules simply win, because they are imperative and the block is optional.
2. **Detection is phrase matching, so it misses paraphrases.** A user who describes a
   decision without using one of the listed phrases gets prose.

The user wants the assistant to decide for itself when decision support helps, the way a
general assistant offers choices rather than waiting to be asked.

## Trigger policy

Cards are warranted in three situations:

- **Competing choices** — the question is about picking between alternatives
  ("mana yang lebih baik A atau B", "fitur mana yang harus dikerjakan dulu").
- **Multiple valid paths** — the question has a real answer, but more than one reasonable
  way forward ("bagaimana cara menambahkan kebutuhan non fungsional"). Answer in prose
  first, then offer the paths.
- **Ambiguous request** — answering well requires knowing which reading was meant
  ("tolong bantu dengan skripsi saya", "perbaiki ini"). Offer the readings instead of
  guessing.

Not warranted for factual lookups, summaries, extractions, greetings, or build/creative
tasks with a single obvious deliverable.

**Suppression is part of the policy, not an afterthought.** When the user is responding to
option cards already in the conversation — picking one, answering the follow-up, or
drilling into a topic the cards raised — no new block is emitted. Under an eager trigger
policy this is what stops every turn from sprouting cards. The classifier already receives
the recent conversation, so it can tell a fresh decision from a continuation.

## Design

### Detection lives in the intent classifier

`backend/src-langchain/query/nodes/intent.ts` already makes one LLM call per query over
the question, the attached file text, and the last four turns, returning
`{useDrive, webSearch, needsReasoning}`. A fourth field, `needsOptions`, is added to that
JSON contract.

This costs no extra latency or tokens — it is a field on a call that already happens on
every query.

Rejected alternative: describing the criteria in the answer prompt and leaving the
judgement to the answer model. That is the mechanism that already failed, and the answer
model is usually the cheaper flash model. Detection needs to be deterministic and
testable; it should not depend on which model answered.

### Plumbing

`backend/src-langchain/query/graph.ts` gains a `needsOptions` channel, threaded from
`prepare` into `generate`. This mirrors the existing `needsReasoning` field exactly — same
shape, no new pattern.

### Instruction

`backend/src-langchain/query/nodes/generate.ts` appends one directive to the prompt when
`needsOptions` is true: the question calls for decision support, so include an
`idss-options` block **in addition to** answering the question. This converts the block
from optional to required for that turn, which is the fix for failure mode 1.

The existing rules keep deciding the block's *shape* — `multiSelect`, `action`
(compare/prioritize/rank), 4-7 options, grounding each option in the document context.
The classifier returns a single boolean and does not duplicate that judgement. A richer
enum (`decide` / `paths` / `clarify`) was considered and rejected: it would encode the
same decision in two places and drift.

The prompt's own criteria wording is also broadened, so the model can still volunteer a
block when the flag is false, and so a forced block is well-formed.

### Model selection is unchanged

Answer-model routing stays on `needsReasoning`. Forcing the pro model whenever cards
appear would roughly double latency on a large share of turns under this trigger policy.
Keeping the knobs separate leaves that easy to revisit.

### Error handling

A parse failure or missing field yields `needsOptions: false`, degrading to exactly
today's behaviour rather than to cards on every turn. This matches how `needsReasoning`
already degrades, including in the node's catch block.

## Testing

- `intent.test.ts` — one case per triggering situation (competing choices, multiple paths,
  ambiguous), one for suppression when the user is answering existing cards, one for
  factual questions staying false, and one for the default-false fallback on a malformed
  response. Note: existing expectations use strict `toEqual` on a four-key object and all
  need the new field.
- `graph.test.ts` — `needsOptions` threads from intent through to `generate`, mirroring the
  existing `needsReasoning` threading test.
- `generate.test.ts` — the directive appears in the prompt when the flag is true and is
  absent when false.

## Risks

- The classifier runs on gemini-2.5-flash with thinking disabled. "Is this ambiguous" is
  the hardest judgement being asked of it and the most likely to need prompt tuning.
- The eager policy means cards on many turns. The suppression rule is what keeps that
  tolerable, so it is the first thing to check if the feature feels noisy in use.
