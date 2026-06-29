# Phase 2b — Library Query in Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a chat message be answered from the pre-indexed Drive library (built in 2a) instead of the per-chat documents, when the user turns on a library toggle — answering with citations that link back to the source Drive document.

**Architecture:** A `queryLibrary(question, history)` function (in `backend/src-langchain/library/`) reuses the Phase 1 `rewrite` + `generate` nodes but retrieves from the `project_rag_library` Qdrant collection with **no conversation filter** (shared corpus). The chat message endpoint gains a per-message `useLibrary` flag; when set, it lazily calls `queryLibrary` instead of the per-chat `queryRag`. Sources carry a `webUrl` so the frontend renders Drive citation links.

**Tech Stack:** TypeScript (ESM, NodeNext), Express 5, Drizzle/Postgres, Qdrant (`@langchain/qdrant`), the Phase 1 query nodes, Next.js frontend. Tests: vitest + supertest.

## Global Constraints

- **Language/module:** TypeScript ESM; every relative import uses a `.js` suffix (NodeNext).
- **Library collection only:** the query reads `config.QDRANT_COLLECTION_LIBRARY` (`project_rag_library`) via `getLibraryVectorStore()` (built in 2a). **No `conversationId` filter** — it is the shared corpus.
- **Reuse Phase 1 nodes:** `rewrite` (`src-langchain/query/nodes/rewrite.js`) and `generate` (`src-langchain/query/nodes/generate.js`). Do not duplicate their logic. `generate` already degrades gracefully (returns `FALLBACK_ANSWER` on LLM error).
- **Citations:** each source carries `webUrl` (the Drive link). `QuerySource` gains an optional `webUrl?: string` — backward-compatible (per-chat sources omit it).
- **Per-message toggle:** `useLibrary` is a per-message boolean. When true, the message is answered from the library *instead of* the per-chat flow. The flag does not change per-chat behavior when absent/false.
- **Keep the n8n-default path light:** `chat-routes.ts` must **lazily** `import()` the library query module only when `useLibrary` is true, so the default (`RAG_PROVIDER=n8n`, no library) path never loads LangChain.
- **Persistence unchanged:** library answers persist as a normal user+assistant turn; the title still falls back to `titleFromQuestion` (the library path returns no title).
- **Empty retrieval:** if the library search returns nothing, answer with a clear "nothing found in the library" message — never a hallucinated answer.
- **Tests:** co-located `*.test.ts`, vitest, `vi.mock` for modules, `src/test/app-harness.js` + supertest for routes. All MOCKED — no live Qdrant/OpenAI. Run from `backend/` with `npm test`.
- **Commits:** plain messages, no conventional-commit prefixes.

---

## File Structure

**New files:**
- `backend/src-langchain/library/query.ts` — `queryLibrary(question, history)`.
- `backend/src-langchain/library/query.test.ts`

**Modified files:**
- `backend/src/rag/types.ts` — add `webUrl?: string` to `QuerySource`.
- `backend/src/rag/chat-routes.ts` — `askSchema` gains `useLibrary`; the message handler branches to `queryLibrary` when set.
- `backend/src/rag/chat-routes.test.ts` — add a `useLibrary` case.
- `frontend/app/(main)/chat/rag-api.ts` — `Source` gains `webUrl?`; `askQuestion` gains a `useLibrary` arg.
- The chat composer + source-rendering components (frontend) — a library toggle + Drive citation links.

---

## Task 1: Library query function

**Files:**
- Modify: `backend/src/rag/types.ts` (add `webUrl?` to `QuerySource`)
- Create: `backend/src-langchain/library/query.ts`
- Test: `backend/src-langchain/library/query.test.ts`

**Interfaces:**
- Consumes: `rewrite` (`{question, history} → {rewritten}`), `generate` (`{question, docs} → {answer, sources}`), `getLibraryVectorStore` (2a, returns a store with `similaritySearch(query, k)`), `ChatTurn`/`QuerySource`.
- Produces: `queryLibrary(question: string, history: ChatTurn[]): Promise<{ answer: string; sources: QuerySource[] }>`.

- [ ] **Step 1: Add `webUrl` to `QuerySource`** in `backend/src/rag/types.ts`:

```ts
export type QuerySource = {
  filename: string;
  chunkIndex: number;
  text: string;
  // Present for library results — links the citation to the source Drive doc.
  webUrl?: string;
};
```

- [ ] **Step 2: Write the failing test** `backend/src-langchain/library/query.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../query/nodes/rewrite.js", () => ({ rewrite: vi.fn(async (s: { question: string }) => ({ rewritten: s.question })) }));
const similaritySearch = vi.fn();
vi.mock("../shared/qdrant.js", () => ({ getLibraryVectorStore: vi.fn(async () => ({ similaritySearch })) }));
vi.mock("../query/nodes/generate.js", () => ({
  generate: vi.fn(async (s: { docs: unknown[] }) => ({ answer: "lib answer", sources: s.docs })),
}));

describe("queryLibrary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("searches the library and maps drive citations", async () => {
    similaritySearch.mockResolvedValue([
      { pageContent: "chunk", metadata: { filename: "doc.pdf", webUrl: "https://drive/x", chunkIndex: 2 } },
    ]);
    const { queryLibrary } = await import("./query.js");
    const r = await queryLibrary("q", []);
    expect(r.answer).toBe("lib answer");
    expect(r.sources[0]).toEqual({ filename: "doc.pdf", webUrl: "https://drive/x", chunkIndex: 2, text: "chunk" });
    // top-K search with no conversation filter (2 args: query, k)
    expect(similaritySearch.mock.calls[0][1]).toBe(8);
  });

  it("returns a no-results message when nothing matches", async () => {
    similaritySearch.mockResolvedValue([]);
    const { queryLibrary } = await import("./query.js");
    const r = await queryLibrary("q", []);
    expect(r.sources).toEqual([]);
    expect(r.answer).toMatch(/couldn't find/i);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd backend && npx vitest run src-langchain/library/query.test.ts`
Expected: FAIL — `./query.js` not found.

- [ ] **Step 4: Implement `query.ts`:**

```ts
import { rewrite } from "../query/nodes/rewrite.js";
import { generate } from "../query/nodes/generate.js";
import { getLibraryVectorStore } from "../shared/qdrant.js";
import type { ChatTurn, QuerySource } from "../../src/rag/types.js";

const NO_RESULTS = "I couldn't find anything relevant in the library.";

export async function queryLibrary(
  question: string,
  history: ChatTurn[],
): Promise<{ answer: string; sources: QuerySource[] }> {
  // Resolve follow-ups against history (reused Phase 1 node), then search the
  // shared library collection — no conversation filter.
  const { rewritten } = await rewrite({ question, history });
  const store = await getLibraryVectorStore();
  const hits = await store.similaritySearch(rewritten, 8);
  const docs: QuerySource[] = hits.map((h) => ({
    filename: String(h.metadata?.filename ?? ""),
    chunkIndex: Number(h.metadata?.chunkIndex ?? 0),
    text: h.pageContent,
    webUrl: typeof h.metadata?.webUrl === "string" ? h.metadata.webUrl : undefined,
  }));
  if (docs.length === 0) return { answer: NO_RESULTS, sources: [] };
  return generate({ question, docs });
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `cd backend && npx vitest run src-langchain/library/query.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/rag/types.ts backend/src-langchain/library/query.ts backend/src-langchain/library/query.test.ts
git commit -m "add the library query with drive citations"
```

---

## Task 2: Wire the `useLibrary` flag into chat-routes

**Files:**
- Modify: `backend/src/rag/chat-routes.ts` (`askSchema` ~272-274; handler ~291-316)
- Modify: `backend/src/rag/chat-routes.test.ts`

**Interfaces:**
- Consumes: `queryLibrary` (Task 1), lazily imported from `../../src-langchain/library/query.js`.
- Produces: `POST /chat/conversations/:id/messages` accepts `{ question, useLibrary? }`; when `useLibrary` is true the answer comes from the library.

- [ ] **Step 1: Write the failing test** — add to `backend/src/rag/chat-routes.test.ts` a mock for the library query module (next to the existing mocks) and a test:

```ts
vi.mock("../../src-langchain/library/query.js", () => ({
  queryLibrary: vi.fn(async () => ({
    answer: "from library",
    sources: [{ filename: "lib.pdf", chunkIndex: 0, text: "t", webUrl: "https://drive/x" }],
  })),
}));
```

```ts
it("answers from the library when useLibrary is set", async () => {
  dbMock.setResult([{ id: "c1" }]); // ownership + inserts
  const res = await request(app())
    .post("/chat/conversations/c1/messages")
    .send({ question: "what is in the library?", useLibrary: true });
  expect(res.status).toBe(200);
  expect(res.body.answer).toBe("from library");
  expect(res.body.sources[0].webUrl).toBe("https://drive/x");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run src/rag/chat-routes.test.ts`
Expected: FAIL — `useLibrary` is ignored, so the answer comes from the mocked `queryRag` ("42"), not "from library".

- [ ] **Step 3: Extend `askSchema`** in `backend/src/rag/chat-routes.ts`:

```ts
const askSchema = z.object({
  question: z.string().trim().min(1).max(4000),
  useLibrary: z.boolean().optional(),
});
```

- [ ] **Step 4: Branch the handler** — replace the destructure and the query block (lines ~291 and ~310-316):

```ts
    const { question, useLibrary } = parsed.data;
```

```ts
    // Query first; persist the turn only after a successful answer so a
    // failure leaves no orphaned message. Library mode answers from the shared
    // Drive index (lazy import so the default path never loads LangChain).
    let result;
    try {
      if (useLibrary) {
        const { queryLibrary } = await import("../../src-langchain/library/query.js");
        result = await queryLibrary(question, history);
      } else {
        result = await queryRag(req.params.id, question, history, isFirstMessage);
      }
    } catch {
      res.status(502).json({ error: "The assistant is unavailable right now" });
      return;
    }
```

(The rest of the handler is unchanged: it persists both turns, and the first-message title falls back to `titleFromQuestion` because the library result carries no `title`.)

- [ ] **Step 5: Run the test + full suite + typecheck**

Run: `cd backend && npx vitest run src/rag/chat-routes.test.ts && npm test && npm run typecheck`
Expected: PASS (all existing chat-routes assertions still pass; the new library case passes).

- [ ] **Step 6: Commit**

```bash
git add backend/src/rag/chat-routes.ts backend/src/rag/chat-routes.test.ts
git commit -m "answer from the library when useLibrary is set"
```

---

## Task 3: Frontend — library toggle + Drive citations

**Files:**
- Modify: `frontend/app/(main)/chat/rag-api.ts` (`Source` + `askQuestion`)
- Modify: the chat composer + the component that renders message sources (locate via the callers of `askQuestion` and `Source`).

No unit runner — verify via `tsc --noEmit` + lint + manual.

- [ ] **Step 1: Extend the API layer** in `frontend/app/(main)/chat/rag-api.ts`:

```ts
export interface Source {
  filename: string;
  chunkIndex: number;
  text: string;
  /** Present for library results — links the citation to the Drive doc. */
  webUrl?: string;
}
```

```ts
export async function askQuestion(
  conversationId: string,
  question: string,
  useLibrary = false,
): Promise<{ answer: string; sources: Source[] }> {
  const { data } = await apiClient.post(
    `/chat/conversations/${conversationId}/messages`,
    useLibrary ? { question, useLibrary: true } : { question },
  );
  return data;
}
```

- [ ] **Step 2: Add the toggle to the composer** — find the component that calls `askQuestion` (the chat send handler) and add a small **"Search library"** toggle (a Radix `Switch` or icon button) near the composer. Hold its state alongside the message input; pass it as the third arg to `askQuestion` on send. Keep it off by default. Reset/persist per your composer's existing input-state pattern.

- [ ] **Step 3: Render Drive citations** — find where assistant message `sources` are displayed and, when a source has `webUrl`, render its `filename` as a link (`<a href={source.webUrl} target="_blank" rel="noopener noreferrer">`). Sources without `webUrl` (per-chat) render as today.

- [ ] **Step 4: Verify**

Run (from `frontend/`): `npx tsc --noEmit` and the project lint.
Expected: clean. Then manual: toggle the library switch, send a question → the answer is library-grounded with clickable Drive citations; toggle off → normal per-chat behavior.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/(main)/chat
git commit -m "add the chat library toggle and drive citations"
```

---

## Self-Review (against the spec)

**Spec coverage (Phase 2 design §4.6, §7, §11 "2b"):**
- Library query: embed → search `project_rag_library` (no conversation filter) → answer with citations → Task 1. ✅
- `useLibrary` per-message flag answering from the library → Task 2. ✅
- Chat toggle + Drive `webUrl` citations → Task 3. ✅
- Reuse Phase 1 generate/§8 degradation → Task 1 (reuses `generate`). ✅
- Persist the turn like any message; title heuristic fallback → Task 2 (handler unchanged below the branch). ✅
- Keep the n8n-default path from loading LangChain → Task 2 (lazy `import()`). ✅
- Empty-retrieval clear message → Task 1 (`NO_RESULTS`). ✅
- **Out of scope (correctly absent):** the sync pipeline (2a, done); sparse/hybrid; scheduled sync; Neo4j; per-user ACLs.

**Placeholder scan:** every backend step shows real code; the frontend toggle/citation steps name the exact files/symbols to change and the verification, with the one genuinely codebase-specific bit (which composer component) described as a locate-by-caller step rather than a fabricated path.

**Type consistency:** `QuerySource.webUrl?: string` (Task 1) flows into `queryLibrary`'s return, the handler's `result.sources`, and the frontend `Source` (Task 3). `queryLibrary(question, history)` (Task 1) matches the call site in Task 2. `rewrite`/`generate` signatures match their Phase 1 definitions (`{question, history}→{rewritten}`, `{question, docs}→{answer, sources}`).
