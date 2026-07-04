# IDSS Brainstorming Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a brainstorming/ideation mode to the IDSS: on ideation questions the model emits an `idss-options` fenced block that the chat frontend renders as interactive single-/multi-select option cards.

**Architecture:** Reuse the existing "model emits a fenced code block → frontend renders a custom component" pipeline (already used for `mermaid` and `csv` in `answer-content.tsx`). The generation prompt (live n8n "Generate Answer" node + the in-process `generate.ts` copy) gains a brainstorming section that outputs an `idss-options` JSON block. A pure parser turns that JSON into a typed object; a new `IdssOptions` React component renders cards and, on click, appends a follow-up user turn via `useThreadRuntime()` (same primitive as Ask More). Multi-select cards feed the existing comparison gate.

**Tech Stack:** TypeScript, React 19, Next.js, Radix Themes, react-markdown, vitest (unit tests), n8n (LangChain chainLlm node, model `z-ai/glm-4.6`).

## Global Constraints

- **Commit messages:** plain sentences, no conventional-commit prefixes (no `feat:`/`fix:`), never mention "pipeshub". (Overrides the `feat:` examples in the writing-plans skill template.)
- **Branch:** work on `dev2` (the canonical branch). Porting backend changes to `vps-backend` is out of scope for this plan.
- **No i18n:** inline English string literals only — no i18next. App is branded "Project RAG".
- **Prompt parity:** the brainstorming instructions must be worded so the n8n "Generate Answer" node and `backend/src-langchain/query/nodes/generate.ts` behave identically. This plan's Task 1 and Task 4 use the same contract.
- **`idss-options` block contract (single source of truth):**
  ````
  ```idss-options
  {
    "multiSelect": false,
    "prompt": "Short question shown above the cards",
    "options": [
      { "label": "Option title", "description": "One-line rationale [1].", "followup": "Question to ask if this option is picked" }
    ]
  }
  ```
  ````
  `multiSelect` boolean; `prompt` optional string; `options` non-empty array; each option: `label` required string, `description` optional string, `followup` optional string.

---

### Task 1: Backend `generate.ts` — brainstorming prompt

**Files:**
- Modify: `backend/src-langchain/query/nodes/generate.ts:14-24` (the `SYSTEM_PROMPT` constant)
- Test: `backend/src-langchain/query/nodes/generate.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `SYSTEM_PROMPT` (exported string) now contains brainstorming/`idss-options` guidance. No signature change to `generate()`.

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe("generate node", …)` block in `generate.test.ts`, after the existing comparison-guidance test:

```ts
it("system prompt carries brainstorming / idss-options guidance", async () => {
  const docs = [{ filename: "d.pdf", chunkIndex: 0, text: "ctx" }];
  const { generate } = await import("./generate.js");
  await generate({ question: "brainstorm some ideas", docs } as never);
  const messages = (invoke.mock.calls[0] as unknown[])[0] as { role: string; content: string }[];
  const system = messages.find((m) => m.role === "system");
  expect(system).toBeDefined();
  expect(system!.content).toMatch(/brainstorm/i);
  expect(system!.content).toMatch(/idss-options/);
  expect(system!.content).toMatch(/multiSelect/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src-langchain/query/nodes/generate.test.ts`
Expected: FAIL — the new test errors on `expect(system!.content).toMatch(/idss-options/)` (prompt has no such text yet). The other four tests still pass.

- [ ] **Step 3: Update `SYSTEM_PROMPT`**

In `generate.ts`, replace the `SYSTEM_PROMPT` template string (currently lines 14-24) with the version below. It keeps every existing sentence and adds one brainstorming paragraph before the final "Never invent facts" line:

```ts
export const SYSTEM_PROMPT = `You answer questions using only the provided context, a numbered list of document excerpts ([1], [2], ...). Cite the excerpts you use by their bracket number. Be concise.

When the question asks you to COMPARE options or decide which is better (e.g. "which is better, X or Y", "X vs Y", "should I pick A or B", "compare ..."), structure the answer as:
1. One sentence stating what is being compared.
2. A markdown table with a "Factor" column and one column per option. Include ONLY factors that appear in the context, and put the citation marker(s) ([n]) in each cell. Do not invent values — if a relevant factor is missing from the context, leave it out of the table.
3. A line starting with "Recommendation:" naming the best option, followed by a 1-2 sentence justification that references the tabulated factors.
4. If a relevant factor was missing from the context, add a short "Note:" line saying which information was not found.

If a comparison cannot be answered from the context at all (general knowledge only), you may still give an opinion, but begin with a clear note that it is based on general knowledge, not the provided documents.

When the question asks you to BRAINSTORM or generate ideas/options (e.g. "brainstorm ...", "give me ideas", "what are my options", "suggest approaches", "list some ways to ..."), you may write one short framing sentence, then end your answer with a fenced code block whose opening fence is \`\`\`idss-options containing a SINGLE JSON object of this exact shape:
\`\`\`idss-options
{ "multiSelect": false, "prompt": "Short question shown above the options", "options": [ { "label": "Option title", "description": "One-line rationale, cite [n] when grounded.", "followup": "Question to ask if this option is picked" } ] }
\`\`\`
Set "multiSelect" to false when the options are distinct directions to explore (each becomes a clickable follow-up); set it to true when the options are candidates the user may want to weigh against each other. Provide 4-7 options grounded in the context; if only general knowledge applies, say so in the framing sentence. Put ONLY the JSON inside the block.

Never invent facts or values that are not in the context.`;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src-langchain/query/nodes/generate.test.ts`
Expected: PASS — all five tests green (the two extraction tests, the comparison test, the error test, and the new brainstorming test).

- [ ] **Step 5: Commit**

```bash
git add backend/src-langchain/query/nodes/generate.ts backend/src-langchain/query/nodes/generate.test.ts
git commit -m "Add brainstorming idss-options guidance to generate prompt"
```

---

### Task 2: Frontend parser — `parseIdssOptions`

**Files:**
- Create: `frontend/app/(main)/chat/utils/parse-idss-options.ts`
- Test: `frontend/app/(main)/chat/utils/__tests__/parse-idss-options.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface IdssOption { label: string; description?: string; followup?: string }`
  - `interface IdssOptionsData { multiSelect: boolean; prompt?: string; options: IdssOption[] }`
  - `function parseIdssOptions(raw: string): IdssOptionsData | null` — returns `null` for any malformed/partial/empty input; never throws. Task 3 consumes these.

- [ ] **Step 1: Write the failing test**

Create `frontend/app/(main)/chat/utils/__tests__/parse-idss-options.test.ts`:

```ts
import { parseIdssOptions } from '../parse-idss-options';

describe('parseIdssOptions', () => {
  it('parses a valid single-select block body', () => {
    const raw = JSON.stringify({
      multiSelect: false,
      prompt: 'Which direction?',
      options: [
        { label: 'A', description: 'rationale a', followup: 'go deeper on A' },
        { label: 'B' },
      ],
    });
    const data = parseIdssOptions(raw);
    expect(data).not.toBeNull();
    expect(data!.multiSelect).toBe(false);
    expect(data!.prompt).toBe('Which direction?');
    expect(data!.options).toHaveLength(2);
    expect(data!.options[0]).toEqual({ label: 'A', description: 'rationale a', followup: 'go deeper on A' });
    expect(data!.options[1].label).toBe('B');
  });

  it('coerces multiSelect to a boolean and defaults it to false', () => {
    const raw = JSON.stringify({ options: [{ label: 'A' }] });
    expect(parseIdssOptions(raw)!.multiSelect).toBe(false);
  });

  it('returns null for malformed JSON (e.g. mid-stream partial)', () => {
    expect(parseIdssOptions('{ "multiSelect": false, "options": [ { "lab')).toBeNull();
  });

  it('returns null when options is missing, empty, or not an array', () => {
    expect(parseIdssOptions(JSON.stringify({ multiSelect: true }))).toBeNull();
    expect(parseIdssOptions(JSON.stringify({ options: [] }))).toBeNull();
    expect(parseIdssOptions(JSON.stringify({ options: 'nope' }))).toBeNull();
  });

  it('drops option entries without a string label, and null-out if none remain', () => {
    const raw = JSON.stringify({ options: [{ description: 'no label' }, { label: 'Keep' }] });
    const data = parseIdssOptions(raw);
    expect(data!.options).toHaveLength(1);
    expect(data!.options[0].label).toBe('Keep');
    expect(parseIdssOptions(JSON.stringify({ options: [{ description: 'x' }] }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run "app/(main)/chat/utils/__tests__/parse-idss-options.test.ts"`
Expected: FAIL — cannot resolve `../parse-idss-options` (module does not exist yet).

- [ ] **Step 3: Write the parser**

Create `frontend/app/(main)/chat/utils/parse-idss-options.ts`:

```ts
/**
 * Parser for the ```idss-options fenced block the RAG answer may emit for
 * brainstorming questions. The block body is a single JSON object describing a
 * set of option cards. Parsing is deliberately defensive: the block can arrive
 * partial (mid-stream) or malformed, so this NEVER throws — it returns null and
 * the renderer shows nothing until a well-formed block is available.
 */

export interface IdssOption {
  label: string;
  description?: string;
  followup?: string;
}

export interface IdssOptionsData {
  multiSelect: boolean;
  prompt?: string;
  options: IdssOption[];
}

export function parseIdssOptions(raw: string): IdssOptionsData | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.options)) return null;

  const options: IdssOption[] = [];
  for (const item of obj.options) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.label !== 'string' || o.label.trim() === '') continue;
    options.push({
      label: o.label,
      description: typeof o.description === 'string' ? o.description : undefined,
      followup: typeof o.followup === 'string' ? o.followup : undefined,
    });
  }
  if (options.length === 0) return null;

  return {
    multiSelect: obj.multiSelect === true,
    prompt: typeof obj.prompt === 'string' ? obj.prompt : undefined,
    options,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run "app/(main)/chat/utils/__tests__/parse-idss-options.test.ts"`
Expected: PASS — all five cases green.

- [ ] **Step 5: Commit**

```bash
git add "frontend/app/(main)/chat/utils/parse-idss-options.ts" "frontend/app/(main)/chat/utils/__tests__/parse-idss-options.test.ts"
git commit -m "Add parser for idss-options brainstorming blocks"
```

---

### Task 3: Frontend `IdssOptions` component + `answer-content` wiring

**Files:**
- Create: `frontend/app/(main)/chat/components/message-area/idss-options.tsx`
- Modify: `frontend/app/(main)/chat/components/message-area/answer-content.tsx` (import + one new branch in the `pre` renderer, near the mermaid branch at ~line 857)

**Interfaces:**
- Consumes: `parseIdssOptions`, `IdssOptionsData`, `IdssOption` from Task 2; `useThreadRuntime` from `@assistant-ui/react`.
- Produces: `function IdssOptions({ data }: { data: IdssOptionsData }): JSX.Element`.

> **Note (intentional v1 simplification):** card `description` text renders as plain text. Citation-badge rendering *inside* cards (turning `[1]` into a clickable badge) is deferred — it would require threading `citationMaps` into the component. The description string still shows any `[n]` markers as literal text. This is a deliberate scope trim from the spec's "descriptions run through citation processing" line.

- [ ] **Step 1: Write the component**

Create `frontend/app/(main)/chat/components/message-area/idss-options.tsx`:

```tsx
'use client';

import React, { useState } from 'react';
import { Box, Flex, Text } from '@radix-ui/themes';
import { useThreadRuntime } from '@assistant-ui/react';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import type { IdssOptionsData } from '../../utils/parse-idss-options';

/** Send a user turn and start a run — same primitive as Ask More. */
function useSendFollowup() {
  const threadRuntime = useThreadRuntime();
  return (text: string) => {
    threadRuntime.append({
      role: 'user',
      content: [{ type: 'text', text }],
      startRun: true,
    });
  };
}

export function IdssOptions({ data }: { data: IdssOptionsData }) {
  const send = useSendFollowup();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [hovered, setHovered] = useState<number | null>(null);

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const handleSingle = (i: number) => {
    const opt = data.options[i];
    send(opt.followup && opt.followup.trim() ? opt.followup : `Tell me more about: ${opt.label}`);
  };

  const handleCompare = () => {
    const labels = [...selected].sort((a, b) => a - b).map((i) => data.options[i].label);
    if (labels.length < 2) return;
    send(`Compare these options: ${labels.join(', ')} — which is better?`);
  };

  return (
    <Box style={{ margin: 'var(--space-3) 0' }}>
      {data.prompt && (
        <Text
          size="2"
          weight="medium"
          as="div"
          style={{ color: 'var(--slate-11)', marginBottom: 'var(--space-2)' }}
        >
          {data.prompt}
        </Text>
      )}

      <Flex direction="column" gap="2">
        {data.options.map((opt, i) => {
          const isSelected = selected.has(i);
          const isHovered = hovered === i;
          const active = data.multiSelect ? isSelected : isHovered;
          return (
            <Box
              key={i}
              role="button"
              tabIndex={0}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => (data.multiSelect ? toggle(i) : handleSingle(i))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  data.multiSelect ? toggle(i) : handleSingle(i);
                }
              }}
              style={{
                cursor: 'pointer',
                padding: 'var(--space-3)',
                borderRadius: 'var(--radius-3)',
                border: `1px solid ${active ? 'var(--accent-8)' : 'var(--slate-6)'}`,
                backgroundColor: active ? 'var(--accent-3)' : 'var(--slate-2)',
                transition: 'background-color 0.12s ease, border-color 0.12s ease',
              }}
            >
              <Flex align="start" gap="2">
                {data.multiSelect && (
                  <Box
                    aria-hidden
                    style={{
                      marginTop: '2px',
                      width: '16px',
                      height: '16px',
                      minWidth: '16px',
                      borderRadius: 'var(--radius-1)',
                      border: `1.5px solid ${isSelected ? 'var(--accent-9)' : 'var(--slate-7)'}`,
                      backgroundColor: isSelected ? 'var(--accent-9)' : 'transparent',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {isSelected && <MaterialIcon name="check" size={11} color="white" />}
                  </Box>
                )}
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Text size="2" weight="bold" as="div" style={{ color: 'var(--slate-12)' }}>
                    {opt.label}
                  </Text>
                  {opt.description && (
                    <Text
                      size="1"
                      as="div"
                      style={{ color: 'var(--slate-11)', marginTop: '2px', lineHeight: 1.5 }}
                    >
                      {opt.description}
                    </Text>
                  )}
                </Box>
                {!data.multiSelect && (
                  <MaterialIcon
                    name="arrow_forward"
                    size={14}
                    color={isHovered ? 'var(--accent-11)' : 'var(--slate-8)'}
                  />
                )}
              </Flex>
            </Box>
          );
        })}
      </Flex>

      {data.multiSelect && (
        <Flex align="center" gap="3" style={{ marginTop: 'var(--space-3)' }}>
          <button
            type="button"
            onClick={handleCompare}
            disabled={selected.size < 2}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              borderRadius: 'var(--radius-2)',
              border: 'none',
              cursor: selected.size < 2 ? 'default' : 'pointer',
              backgroundColor: selected.size < 2 ? 'var(--slate-4)' : 'var(--accent-9)',
              color: selected.size < 2 ? 'var(--slate-9)' : 'white',
              fontSize: '13px',
              fontWeight: 500,
              transition: 'background-color 0.12s ease',
            }}
          >
            <MaterialIcon name="balance" size={14} color={selected.size < 2 ? 'var(--slate-9)' : 'white'} />
            Compare selected
          </button>
          <Text size="1" style={{ color: 'var(--slate-9)' }}>
            {selected.size < 2 ? 'Select at least two options' : `${selected.size} selected`}
          </Text>
        </Flex>
      )}
    </Box>
  );
}
```

- [ ] **Step 2: Add the import to `answer-content.tsx`**

Below the existing `import { MermaidDiagram } from './mermaid-diagram';` line (~line 22), add:

```tsx
import { IdssOptions } from './idss-options';
import { parseIdssOptions } from '../../utils/parse-idss-options';
```

- [ ] **Step 3: Add the `pre` render branch**

In `answer-content.tsx`, inside the `pre:` renderer, immediately after the mermaid branch (the `if (lang.includes('language-mermaid')) { … }` block that ends ~line 863) and before the `// ```csv` branch, insert:

```tsx
        // ```idss-options — render as interactive brainstorming option cards
        if (lang.includes('language-idss-options')) {
          const raw =
            typeof codeEl.props?.children === 'string'
              ? codeEl.props.children
              : extractNodeText(codeEl.props?.children);
          const data = parseIdssOptions(raw);
          // Malformed or still-streaming (partial JSON) → render nothing.
          return data ? <IdssOptions data={data} /> : null;
        }
```

- [ ] **Step 4: Typecheck and lint the frontend**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: no type errors and no new lint errors in `idss-options.tsx` or `answer-content.tsx`.

> If `threadRuntime.append`'s type signature differs from the Ask More call site, match `message-list.tsx:1094-1098` exactly — that call is the known-good reference for this codebase's `@assistant-ui/react` version.

- [ ] **Step 5: Commit**

```bash
git add "frontend/app/(main)/chat/components/message-area/idss-options.tsx" "frontend/app/(main)/chat/components/message-area/answer-content.tsx"
git commit -m "Render interactive idss-options brainstorming cards in chat"
```

---

### Task 4: Live n8n "Generate Answer" prompt

**Files:**
- Modify (in n8n, not git): workflow **RAG Query** (`H4WL7om1JO3UmavC`), node **Generate Answer** (`3d0b6196-06e7-409f-906e-159148974805`, type `@n8n/n8n-nodes-langchain.chainLlm`). Edit `parameters.text`.

**Interfaces:**
- Consumes: the same `idss-options` block contract from Global Constraints.
- Produces: the live glm-4.6 prompt now emits `idss-options` blocks on brainstorming questions — this is what the deployed chat actually runs.

- [ ] **Step 1: Fetch the current node text**

Use `mcp__claude_ai_n8n__get_workflow_details` with `workflowId: "H4WL7om1JO3UmavC"`. Copy the exact current `parameters.text` of the "Generate Answer" node so the edit is a pure insertion (no accidental loss of the existing Comparing / Diagrams / How-to-write sections).

- [ ] **Step 2: Insert the brainstorming section**

Insert this block into `parameters.text` immediately **after** the "Comparing options or deciding which is better …" bullet group and **before** the "Diagrams and flowcharts:" section (keep the surrounding text verbatim):

````
Brainstorming or generating ideas/options (e.g. "brainstorm ...", "give me ideas", "what are my options", "suggest approaches", "list some ways to ..."):
- You may write one short framing sentence, then output a fenced code block whose opening fence is ```idss-options containing a SINGLE JSON object of this exact shape:
```idss-options
{ "multiSelect": false, "prompt": "Short question shown above the options", "options": [ { "label": "Option title", "description": "One-line rationale, cite [n] when grounded.", "followup": "Question to ask if this option is picked" } ] }
```
- Set "multiSelect" to false when the options are distinct directions to explore (each becomes a clickable follow-up); set it to true when the options are candidates the user may want to weigh against each other (they can select several and compare).
- Provide 4-7 options. Ground each option in the document context when the question is about their documents; if drawing on general knowledge, say so in the framing sentence, and never invent document content.
- Put ONLY the JSON inside the block. This block is an allowed exception to the "avoid lists" guidance below.
````

- [ ] **Step 3: Apply the update and publish**

Before editing, call `mcp__claude_ai_n8n__get_sdk_reference` (per the n8n MCP usage rules). Update the "Generate Answer" node's `parameters.text` to the new value (via the n8n update flow — `update_workflow` / `create_workflow_from_code` as appropriate), leaving every other node untouched. Then `validate_workflow`, fix any errors, and `publish_workflow` so the active version serves the new prompt.

- [ ] **Step 4: Smoke-test the webhook**

Run against the live production webhook (adjust the question to a topic your loaded docs cover):

```bash
curl -s -X POST https://n8n.ariorafa.site/webhook/rag-query \
  -H 'Content-Type: application/json' \
  -d '{"conversationId":"plan-smoke-1","question":"brainstorm some approaches for this","history":[],"docs":[{"filename":"note.txt","text":"We are choosing a caching strategy: Redis, in-memory LRU, or CDN edge cache."}],"libraryDocs":[]}' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.answer)})"
```

Expected: the printed `answer` contains a ` ```idss-options ` fenced block with a JSON object whose `options` array has ≥2 entries. If it does not, refine the wording in Step 2 (the model must recognise "brainstorm" as the trigger) and re-publish.

- [ ] **Step 5: No commit**

This change lives in n8n only (not git). Record in the PR/description that the live "Generate Answer" node was updated, mirroring the `generate.ts` wording from Task 1.

---

### Task 5: Manual end-to-end verification

**Files:** none (verification only).

**Interfaces:** exercises Tasks 1-4 together.

- [ ] **Step 1: Run the app**

Start the frontend (`cd frontend && npm run dev`) pointed at the backend that proxies to the live n8n webhook, or use the deployed environment. Open a chat.

- [ ] **Step 2: Single-select path**

Attach a short document, then ask: *"brainstorm some approaches for this"*.
Expected: the answer renders a set of **option cards** (bold title + one-line description, a `→` on hover). Clicking a card sends a follow-up question and the chat continues with that topic.

- [ ] **Step 3: Multi-select → compare path**

Ask a question where the model returns `multiSelect: true` (e.g. *"what are my options here, and I want to weigh them"*).
Expected: cards show **checkboxes**; selecting ≥2 enables **"Compare selected"**; clicking it sends a "Compare these options…" turn that returns the existing IDSS **factor table + Recommendation**.

- [ ] **Step 4: Robustness check**

Confirm a normal (non-brainstorming) question is unaffected — no cards, plain answer — and that a brainstorming answer arriving mid-stream never flashes a raw JSON blob or crashes the message (the `pre` branch returns `null` until the block is complete).

- [ ] **Step 5: Record the result**

Note the verification outcome (screenshots optional) in the PR description. If any step fails, return to the owning task (frontend → Task 3, prompt/trigger → Task 1 & 4).

---

## Self-Review

**Spec coverage:**
- Emission format → Task 1 (generate.ts) + Task 4 (n8n), identical contract in Global Constraints. ✓
- Rendering (new component + `pre` branch, defensive parsing) → Task 2 (parser) + Task 3 (component/wiring). ✓
- Interaction (single-select follow-up; multi-select → compare into existing gate) → Task 3 `handleSingle`/`handleCompare`. ✓
- Trigger (phrasing-based) → Task 1 & Task 4 prompt wording; no UI toggle. ✓
- Styling (Radix + jade theme, screenshot layout) → Task 3 card styles. ✓
- Prompt parity across n8n + generate.ts → Global Constraints + Task 1/Task 4 share wording. ✓
- Testing (unit for prompt + parser; manual E2E) → Task 1, Task 2, Task 5. ✓
- Out-of-scope items (no composer toggle, no backend schema/SSE, no selection persistence, no MCDM) → not built. ✓
- Deviation: citation-badge rendering *inside* cards deferred (noted in Task 3). Descriptions render as plain text; `[n]` markers show literally. Acceptable trim; flag to user.

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every code and command step is concrete. ✓

**Type consistency:** `IdssOptionsData` / `IdssOption` / `parseIdssOptions` names and shapes match between Task 2 (definition) and Task 3 (consumption); `threadRuntime.append({ role, content:[{type:'text',text}], startRun:true })` matches the `message-list.tsx` reference. ✓
