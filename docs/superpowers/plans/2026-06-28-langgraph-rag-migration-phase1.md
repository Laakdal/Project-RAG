# LangGraph RAG Migration — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the n8n RAG path with a LangChain/LangGraph (JS) implementation living in `backend/src-langchain/`, selected by a global `RAG_PROVIDER` switch, while n8n stays the default until cutover.

**Architecture:** A `RagProvider` seam (`backend/src/rag/provider.ts`) sits between `chat-routes.ts` and the two implementations. `n8nProvider` wraps today's `n8n-client.ts` (unchanged). `langgraphProvider` (new, `src-langchain/`) runs ingest (Gemini read → chunk → embed → Qdrant upsert) and a corrective-RAG query graph (rewrite → retrieve + grade → branch docs/web → generate → title). Postgres/auth/chat are untouched. The langgraph path writes to a fresh Qdrant collection `project_rag_chat_lg`.

**Tech Stack:** TypeScript (ESM, NodeNext), Express 5, Drizzle/Postgres, Qdrant, `@langchain/openai`, `@langchain/qdrant`, `@langchain/textsplitters`, `@langchain/langgraph`, `@langchain/core`. Tests: vitest + supertest.

## Global Constraints

- **Language/module:** TypeScript ESM. Every relative import uses a `.js` suffix (NodeNext). Match the existing code style.
- **Models (do not change):** read = `google/gemini-2.5-flash` via OpenRouter HTTP; embeddings = OpenAI `text-embedding-3-small` (1536-D, Cosine); generation = OpenAI `gpt-4o-mini` via the **Responses API** with the built-in `web_search_preview` tool.
- **New Qdrant collection:** `project_rag_chat_lg` (never reuse the n8n collection `project_rag_chat_oai`).
- **Default provider stays n8n.** `RAG_PROVIDER` defaults to `n8n`; nothing in Phase 1 flips it in production.
- **Minimal blast radius in `src/`:** the only change to existing `src/` source is swapping the import in `chat-routes.ts` from `./n8n-client.js` to `./provider.js`, plus additive config keys. `n8n-client.ts` is not modified.
- **Tests:** co-located `*.test.ts`, vitest, `vi.stubGlobal("fetch", vi.fn())` for HTTP, `vi.mock` for module mocks. Run from `backend/` with `npm test`.
- **Library churn:** `@langchain/*` JS APIs are version-sensitive. For every task that calls a LangChain/LangGraph class, confirm the exact constructor/method signature against current docs (context7 MCP: `resolve-library-id` → `query-docs`) before finalizing — the code below reflects verified patterns but pin the version at implementation.
- **Commits:** plain messages, no conventional-commit prefixes. (The example commits below use a short imperative line; keep that style.)
- **Ingest is synchronous in Phase 1** (see "Scope decision" below). The async instant-upload optimization from the spec's Section 5 is deferred to keep `chat-routes.ts` and the frontend unchanged.

### Scope decision (read before starting)

The spec (Section 5) preferred async indexing (insert `indexing` → background-index → update to `ready`), which preserves n8n's instant-upload UX but requires a `chat-routes.ts` refactor **and** a frontend polling change. To keep Phase 1 tight and blast radius minimal, **Phase 1 keeps the existing synchronous flow**: `langgraphProvider.ingestFile` runs the full pipeline and returns the real `chunkCount`; `chat-routes.ts` inserts the attachment as `ready` exactly as it does today. The cost is that an upload blocks (~10-20s) instead of returning instantly. Async instant-upload is a tracked follow-up, not part of this plan.

---

## File Structure

**New files:**
- `backend/src/rag/types.ts` — shared RAG types + `RagProvider` interface.
- `backend/src/rag/provider.ts` — provider selection + convenience `queryRag`/`ingestFile` wrappers.
- `backend/src/rag/provider.test.ts` — dispatch tests.
- `backend/src-langchain/index.ts` — `langgraphProvider` (positional `queryRag`/`ingestFile`).
- `backend/src-langchain/shared/models.ts` — embeddings + chat-model factories + `geminiRead`.
- `backend/src-langchain/shared/qdrant.ts` — vector-store factory for `project_rag_chat_lg`.
- `backend/src-langchain/ingest/read.ts` — document → text (PDF direct, DOCX via Gotenberg).
- `backend/src-langchain/ingest/pipeline.ts` — read → chunk → embed → upsert.
- `backend/src-langchain/query/nodes/{rewrite,retrieve,grade,generate,webSearch,title}.ts` — graph nodes.
- `backend/src-langchain/query/graph.ts` — assembles the LangGraph; exports `runQuery`.
- Co-located `*.test.ts` beside each new `src-langchain` source file.

**Modified files:**
- `backend/src/config.ts` — add `RAG_PROVIDER` + langgraph env keys.
- `backend/src/config.test.ts` — assert `RAG_PROVIDER` default.
- `backend/src/rag/chat-routes.ts:14` — import from `./provider.js` instead of `./n8n-client.js`.
- `backend/package.json` — add `@langchain/*` deps.
- `backend/tsconfig.json` — `include` `src-langchain/**/*.ts`.
- `backend/vitest.config.ts` — `include` `src-langchain/**/*.test.ts` + dummy env for new keys.

**Unchanged:** `backend/src/rag/n8n-client.ts`, `backend/src/db/schema.ts`, all auth/admin code.

---

## Milestone 1 — Provider seam (no behavior change; n8n stays default)

Delivers a routed-through-a-seam backend that behaves identically to today. Independently shippable.

### Task 1: Add `RAG_PROVIDER` and langgraph env keys to config

**Files:**
- Modify: `backend/src/config.ts:10-27` (the `envSchema`)
- Modify: `backend/vitest.config.ts:11-15` (dummy env)
- Test: `backend/src/config.test.ts`

**Interfaces:**
- Produces: `config.RAG_PROVIDER: "n8n" | "langgraph"` (default `"n8n"`); optional `config.QDRANT_URL`, `config.QDRANT_COLLECTION_LG`, `config.OPENAI_API_KEY`, `config.OPENROUTER_API_KEY`, `config.GOTENBERG_URL`, `config.GEMINI_READ_MODEL`, `config.EMBED_MODEL`, `config.GENERATE_MODEL`.

- [ ] **Step 1: Write the failing test** — append to `backend/src/config.test.ts`:

```ts
it("defaults RAG_PROVIDER to n8n", () => {
  expect(config.RAG_PROVIDER).toBe("n8n");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run src/config.test.ts`
Expected: FAIL — `config.RAG_PROVIDER` is `undefined`.

- [ ] **Step 3: Add the keys to `envSchema`** in `backend/src/config.ts`, after the `N8N_BASE_URL` line (keep the closing `});`):

```ts
  N8N_BASE_URL: z.string().url().default("http://localhost:5678"),

  // RAG backend selector. n8n (default) keeps the existing webhook path;
  // langgraph routes to the in-process LangChain/LangGraph implementation.
  RAG_PROVIDER: z.enum(["n8n", "langgraph"]).default("n8n"),

  // Langgraph-path config. Optional because the default provider is n8n; the
  // langgraph provider validates presence at use and throws a clear error.
  QDRANT_URL: z.string().url().optional(),
  QDRANT_COLLECTION_LG: z.string().min(1).default("project_rag_chat_lg"),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  GOTENBERG_URL: z.string().url().optional(),
  GEMINI_READ_MODEL: z.string().min(1).default("google/gemini-2.5-flash"),
  EMBED_MODEL: z.string().min(1).default("text-embedding-3-small"),
  GENERATE_MODEL: z.string().min(1).default("gpt-4o-mini"),
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd backend && npx vitest run src/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Keep vitest env coherent** — no new required keys were added (all optional/defaulted), so `vitest.config.ts` needs no new values. Confirm the whole suite still imports config cleanly:

Run: `cd backend && npm test`
Expected: PASS (all existing tests green).

- [ ] **Step 6: Commit**

```bash
git add backend/src/config.ts backend/src/config.test.ts
git commit -m "add RAG_PROVIDER switch and langgraph config keys"
```

### Task 2: Define shared RAG types + `RagProvider` interface

**Files:**
- Create: `backend/src/rag/types.ts`

**Interfaces:**
- Produces: `QuerySource`, `QueryResult`, `IngestResult`, `ChatTurn`, and `RagProvider` (positional-arg method signatures matching today's `n8n-client.ts`).

- [ ] **Step 1: Create the file** `backend/src/rag/types.ts`:

```ts
// Shared RAG contract. Both providers (n8n, langgraph) satisfy these shapes so
// chat-routes.ts is provider-agnostic. Signatures are positional to match the
// existing n8n-client.ts exactly, so wiring the seam is a one-line import swap.

export type QuerySource = {
  filename: string;
  chunkIndex: number;
  text: string;
};

export type QueryResult = {
  answer: string;
  sources: QuerySource[];
  title?: string;
};

export type IngestResult = {
  status: string;
  chunkCount: number;
};

export type ChatTurn = { role: string; content: string };

export interface RagProvider {
  queryRag(
    conversationId: string,
    question: string,
    history: ChatTurn[],
    generateTitle: boolean,
  ): Promise<QueryResult>;

  ingestFile(
    conversationId: string,
    filename: string,
    file: Buffer,
    mimeType: string,
  ): Promise<IngestResult>;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd backend && npm run typecheck`
Expected: PASS (no usages yet; this is a types-only module — it is exercised by Task 3's tests).

- [ ] **Step 3: Commit**

```bash
git add backend/src/rag/types.ts
git commit -m "add shared RagProvider types"
```

### Task 3: Create the provider seam (`provider.ts`), defaulting to n8n

**Files:**
- Create: `backend/src/rag/provider.ts`
- Test: `backend/src/rag/provider.test.ts`

**Interfaces:**
- Consumes: `config.RAG_PROVIDER` (Task 1); `RagProvider`, result types (Task 2); the existing `./n8n-client.js` `queryRag`/`ingestFile`; a lazily-imported `langgraphProvider` from `../../src-langchain/index.js` (Task 17).
- Produces: `queryRag(...)` and `ingestFile(...)` free functions with the **same positional signatures** as `n8n-client.ts`, dispatching on `config.RAG_PROVIDER`. These are what `chat-routes.ts` imports.

- [ ] **Step 1: Write the failing test** `backend/src/rag/provider.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// The n8n implementation is mocked; the langgraph module is mocked so the seam
// can be tested without loading LangChain. Selection is driven by config, which
// reads process.env at import time — so set it before importing provider.ts.
vi.mock("./n8n-client.js", () => ({
  queryRag: vi.fn(async () => ({ answer: "n8n-answer", sources: [] })),
  ingestFile: vi.fn(async () => ({ status: "ok", chunkCount: 1 })),
}));

const lgQuery = vi.fn(async () => ({ answer: "lg-answer", sources: [] }));
const lgIngest = vi.fn(async () => ({ status: "ok", chunkCount: 2 }));
vi.mock("../../src-langchain/index.js", () => ({
  langgraphProvider: { queryRag: lgQuery, ingestFile: lgIngest },
}));

describe("rag provider seam", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes to n8n by default", async () => {
    const provider = await import("./provider.js");
    const r = await provider.queryRag("c1", "q", [], false);
    expect(r.answer).toBe("n8n-answer");
    expect(lgQuery).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run src/rag/provider.test.ts`
Expected: FAIL — `./provider.js` does not exist.

- [ ] **Step 3: Create `backend/src/rag/provider.ts`:**

```ts
import { config } from "../config.js";
import * as n8n from "./n8n-client.js";
import type { ChatTurn, QueryResult, IngestResult } from "./types.js";

// Dispatch on the global RAG_PROVIDER switch. The langgraph module is imported
// lazily so its heavy LangChain deps load only when actually selected (the n8n
// default path and most tests never touch them).
async function langgraph() {
  const mod = await import("../../src-langchain/index.js");
  return mod.langgraphProvider;
}

export async function queryRag(
  conversationId: string,
  question: string,
  history: ChatTurn[] = [],
  generateTitle = false,
): Promise<QueryResult> {
  if (config.RAG_PROVIDER === "langgraph") {
    return (await langgraph()).queryRag(conversationId, question, history, generateTitle);
  }
  return n8n.queryRag(conversationId, question, history, generateTitle);
}

export async function ingestFile(
  conversationId: string,
  filename: string,
  file: Buffer,
  mimeType: string,
): Promise<IngestResult> {
  if (config.RAG_PROVIDER === "langgraph") {
    return (await langgraph()).ingestFile(conversationId, filename, file, mimeType);
  }
  return n8n.ingestFile(conversationId, filename, file, mimeType);
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd backend && npx vitest run src/rag/provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/rag/provider.ts backend/src/rag/provider.test.ts
git commit -m "add rag provider seam defaulting to n8n"
```

### Task 4: Route chat-routes through the seam

**Files:**
- Modify: `backend/src/rag/chat-routes.ts:14`

**Interfaces:**
- Consumes: `queryRag`/`ingestFile` from `./provider.js` (Task 3).

- [ ] **Step 1: Swap the import** — change `backend/src/rag/chat-routes.ts` line 14 from:

```ts
import { queryRag, ingestFile } from "./n8n-client.js";
```

to:

```ts
import { queryRag, ingestFile } from "./provider.js";
```

(No other line changes. `provider.queryRag`/`ingestFile` have identical signatures.)

- [ ] **Step 2: Run the existing chat-routes tests — they must still pass unchanged**

Run: `cd backend && npx vitest run src/rag/chat-routes.test.ts`
Expected: PASS. The test mocks `./n8n-client.js`; `provider.ts` calls that same mocked module under the default `RAG_PROVIDER=n8n`, so behavior and call assertions are preserved.

- [ ] **Step 3: Run the full suite + typecheck**

Run: `cd backend && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/rag/chat-routes.ts
git commit -m "route chat ingest and query through the provider seam"
```

> **Milestone 1 checkpoint:** the backend is now seam-routed and identical in behavior. Safe to merge/deploy on its own. Everything after this builds the langgraph implementation behind the (still-default-off) switch.

---

## Milestone 2 — Build setup, shared infra, ingest pipeline

### Task 5: Add LangChain deps and extend build/test globs

**Files:**
- Modify: `backend/package.json` (dependencies)
- Modify: `backend/tsconfig.json:18` (include)
- Modify: `backend/vitest.config.ts:6` (include)

- [ ] **Step 1: Install the deps**

Run:
```bash
cd backend && npm install @langchain/core @langchain/openai @langchain/qdrant @langchain/textsplitters @langchain/langgraph
```
(Confirm current package names/versions via context7 first — the Qdrant integration package in particular has moved between `@langchain/community` and `@langchain/qdrant` across versions.)

- [ ] **Step 2: Extend `tsconfig.json` include** — change line 18 to add the sibling tree:

```json
  "include": ["src/**/*.ts", "src-langchain/**/*.ts", "scripts/**/*.ts", "drizzle.config.ts"],
```

- [ ] **Step 3: Extend `vitest.config.ts` include** — change line 6:

```ts
    include: ["src/**/*.test.ts", "src-langchain/**/*.test.ts"],
```

- [ ] **Step 4: Verify the toolchain sees the new tree** — create a throwaway `backend/src-langchain/_smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";
describe("src-langchain wiring", () => {
  it("runs", () => expect(1 + 1).toBe(2));
});
```

Run: `cd backend && npm test && npm run typecheck`
Expected: PASS, and the smoke test is collected. Then delete `_smoke.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/tsconfig.json backend/vitest.config.ts
git commit -m "add langchain deps and include src-langchain in build and tests"
```

### Task 6: Shared models — embeddings, chat model, and `geminiRead`

**Files:**
- Create: `backend/src-langchain/shared/models.ts`
- Test: `backend/src-langchain/shared/models.test.ts`

**Interfaces:**
- Consumes: `config` (OPENAI/OPENROUTER keys, model names).
- Produces:
  - `makeEmbeddings(): OpenAIEmbeddings`
  - `makeChatModel(opts?: { webSearch?: boolean }): ChatOpenAI`
  - `geminiRead(file: Buffer, mimeType: string): Promise<string>` — sends bytes to OpenRouter's Gemini model and returns extracted text.
  - `requireLanggraphEnv(): void` — throws if `OPENAI_API_KEY`/`OPENROUTER_API_KEY`/`QDRANT_URL` are missing.

- [ ] **Step 1: Write the failing test** `models.test.ts` (focus on `geminiRead`, the only logic-bearing piece; the factories are thin wrappers):

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe("geminiRead", () => {
  it("posts the file to OpenRouter and returns the extracted text", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "extracted text" } }] }),
    });
    const { geminiRead } = await import("./models.js");
    const text = await geminiRead(Buffer.from("%PDF-1.4"), "application/pdf");
    expect(text).toBe("extracted text");
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("openrouter");
  });

  it("throws on a non-ok response", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500 });
    const { geminiRead } = await import("./models.js");
    await expect(geminiRead(Buffer.from("x"), "application/pdf")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run src-langchain/shared/models.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `models.ts`** (confirm `ChatOpenAI`/`OpenAIEmbeddings` options and the web-search tool name `web_search_preview` against context7):

```ts
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { config } from "../../src/config.js";

export function requireLanggraphEnv(): void {
  const missing = [
    !config.OPENAI_API_KEY && "OPENAI_API_KEY",
    !config.OPENROUTER_API_KEY && "OPENROUTER_API_KEY",
    !config.QDRANT_URL && "QDRANT_URL",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`RAG_PROVIDER=langgraph requires: ${missing.join(", ")}`);
  }
}

export function makeEmbeddings(): OpenAIEmbeddings {
  return new OpenAIEmbeddings({
    model: config.EMBED_MODEL,
    apiKey: config.OPENAI_API_KEY,
  });
}

export function makeChatModel(opts: { webSearch?: boolean } = {}): ChatOpenAI {
  const model = new ChatOpenAI({
    model: config.GENERATE_MODEL,
    apiKey: config.OPENAI_API_KEY,
    useResponsesApi: true,
  });
  return opts.webSearch
    ? (model.bindTools([{ type: "web_search_preview" }]) as ChatOpenAI)
    : model;
}

// Read a document by handing the raw bytes to Gemini (vision/multimodal) over
// OpenRouter's OpenAI-compatible chat completions endpoint. Returns plain text.
export async function geminiRead(file: Buffer, mimeType: string): Promise<string> {
  const dataUrl = `data:${mimeType};base64,${file.toString("base64")}`;
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: config.GEMINI_READ_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Extract all readable text from this document. Return only the text." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`gemini read failed: ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}
```

> Note: confirm OpenRouter's accepted content-part shape for PDF bytes against current OpenRouter docs (file vs image_url part); the test only asserts the endpoint + return parsing, so adjust the body shape without breaking the test.

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd backend && npx vitest run src-langchain/shared/models.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src-langchain/shared/models.ts backend/src-langchain/shared/models.test.ts
git commit -m "add langgraph shared models and gemini reader"
```

### Task 7: Qdrant vector-store factory

**Files:**
- Create: `backend/src-langchain/shared/qdrant.ts`
- Test: `backend/src-langchain/shared/qdrant.test.ts`

**Interfaces:**
- Consumes: `makeEmbeddings` (Task 6); `config.QDRANT_URL`, `config.QDRANT_COLLECTION_LG`.
- Produces: `getVectorStore(): Promise<QdrantVectorStore>` — bound to `project_rag_chat_lg`, creating the collection if absent.

- [ ] **Step 1: Write the failing test** `qdrant.test.ts` (mock the LangChain Qdrant module so no server is needed):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const fromExisting = vi.fn(async () => ({ tag: "store" }));
vi.mock("@langchain/qdrant", () => ({
  QdrantVectorStore: { fromExistingCollection: fromExisting },
}));
vi.mock("./models.js", () => ({ makeEmbeddings: () => ({ tag: "emb" }) }));

describe("getVectorStore", () => {
  beforeEach(() => vi.clearAllMocks());
  it("binds to the langgraph collection", async () => {
    const { getVectorStore } = await import("./qdrant.js");
    await getVectorStore();
    const [, opts] = fromExisting.mock.calls[0];
    expect(opts.collectionName).toBe("project_rag_chat_lg");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run src-langchain/shared/qdrant.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `qdrant.ts`** (confirm `QdrantVectorStore` factory + auto-create behavior against context7; `fromExistingCollection` will create on first `addDocuments` in some versions — if not, call the Qdrant REST `PUT /collections/{name}` once):

```ts
import { QdrantVectorStore } from "@langchain/qdrant";
import { config } from "../../src/config.js";
import { makeEmbeddings } from "./models.js";

export async function getVectorStore(): Promise<QdrantVectorStore> {
  return QdrantVectorStore.fromExistingCollection(makeEmbeddings(), {
    url: config.QDRANT_URL,
    collectionName: config.QDRANT_COLLECTION_LG,
  });
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd backend && npx vitest run src-langchain/shared/qdrant.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src-langchain/shared/qdrant.ts backend/src-langchain/shared/qdrant.test.ts
git commit -m "add qdrant vector store factory for the langgraph collection"
```

### Task 8: Document reader (PDF direct, DOCX via Gotenberg)

**Files:**
- Create: `backend/src-langchain/ingest/read.ts`
- Test: `backend/src-langchain/ingest/read.test.ts`

**Interfaces:**
- Consumes: `geminiRead` (Task 6); `config.GOTENBERG_URL`.
- Produces: `readDocument(file: Buffer, mimeType: string): Promise<string>` — PDFs go straight to `geminiRead`; DOCX is converted to PDF via Gotenberg first, then read.

- [ ] **Step 1: Write the failing test** `read.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const geminiRead = vi.fn(async () => "doc text");
vi.mock("../shared/models.js", () => ({ geminiRead }));

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("readDocument", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads a PDF directly without conversion", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { readDocument } = await import("./read.js");
    const text = await readDocument(Buffer.from("%PDF"), "application/pdf");
    expect(text).toBe("doc text");
    expect(fetch).not.toHaveBeenCalled(); // no Gotenberg hop for PDFs
    vi.unstubAllGlobals();
  });

  it("converts DOCX via Gotenberg before reading", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })));
    const { readDocument } = await import("./read.js");
    const text = await readDocument(Buffer.from("PK"), DOCX);
    expect(text).toBe("doc text");
    expect(fetch).toHaveBeenCalled(); // Gotenberg was hit
    // The bytes passed to gemini are the converted PDF, declared as application/pdf.
    expect(geminiRead.mock.calls[0][1]).toBe("application/pdf");
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run src-langchain/ingest/read.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `read.ts`** (confirm Gotenberg's LibreOffice route `/forms/libreoffice/convert` and multipart field name against the existing Gotenberg container's version):

```ts
import { geminiRead } from "../shared/models.js";
import { config } from "../../src/config.js";

const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function docxToPdf(file: Buffer, filename = "in.docx"): Promise<Buffer> {
  if (!config.GOTENBERG_URL) throw new Error("GOTENBERG_URL required for DOCX");
  const form = new FormData();
  form.append("files", new Blob([file], { type: DOCX }), filename);
  const res = await fetch(
    `${config.GOTENBERG_URL.replace(/\/$/, "")}/forms/libreoffice/convert`,
    { method: "POST", body: form },
  );
  if (!res.ok) throw new Error(`gotenberg convert failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function readDocument(file: Buffer, mimeType: string): Promise<string> {
  if (mimeType === DOCX) {
    const pdf = await docxToPdf(file);
    return geminiRead(pdf, "application/pdf");
  }
  return geminiRead(file, mimeType);
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd backend && npx vitest run src-langchain/ingest/read.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src-langchain/ingest/read.ts backend/src-langchain/ingest/read.test.ts
git commit -m "add document reader with gotenberg docx conversion"
```

### Task 9: Ingest pipeline — read → chunk → embed → upsert

**Files:**
- Create: `backend/src-langchain/ingest/pipeline.ts`
- Test: `backend/src-langchain/ingest/pipeline.test.ts`

**Interfaces:**
- Consumes: `readDocument` (Task 8); `getVectorStore` (Task 7); `RecursiveCharacterTextSplitter`; `IngestResult` (types).
- Produces: `ingest(conversationId: string, filename: string, file: Buffer, mimeType: string): Promise<IngestResult>` — chunk metadata is `{ conversationId, filename, chunkIndex }`; returns `{ status: "ok", chunkCount }`.

- [ ] **Step 1: Write the failing test** `pipeline.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const addDocuments = vi.fn(async () => undefined);
vi.mock("../shared/qdrant.js", () => ({
  getVectorStore: vi.fn(async () => ({ addDocuments })),
}));
vi.mock("./read.js", () => ({
  readDocument: vi.fn(async () => "alpha beta gamma. delta epsilon."),
}));

describe("ingest pipeline", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads, chunks, and upserts with per-conversation metadata", async () => {
    const { ingest } = await import("./pipeline.js");
    const result = await ingest("c1", "doc.pdf", Buffer.from("%PDF"), "application/pdf");
    expect(result.status).toBe("ok");
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(addDocuments).toHaveBeenCalledTimes(1);
    const docs = addDocuments.mock.calls[0][0] as { metadata: Record<string, unknown> }[];
    expect(docs[0].metadata).toMatchObject({
      conversationId: "c1",
      filename: "doc.pdf",
      chunkIndex: 0,
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run src-langchain/ingest/pipeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `pipeline.ts`:**

```ts
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";
import { readDocument } from "./read.js";
import { getVectorStore } from "../shared/qdrant.js";
import type { IngestResult } from "../../src/rag/types.js";

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 150,
});

export async function ingest(
  conversationId: string,
  filename: string,
  file: Buffer,
  mimeType: string,
): Promise<IngestResult> {
  const text = await readDocument(file, mimeType);
  const chunks = await splitter.splitText(text);
  const docs = chunks.map(
    (content, chunkIndex) =>
      new Document({
        pageContent: content,
        metadata: { conversationId, filename, chunkIndex },
      }),
  );
  if (docs.length > 0) {
    const store = await getVectorStore();
    await store.addDocuments(docs);
  }
  return { status: "ok", chunkCount: docs.length };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd backend && npx vitest run src-langchain/ingest/pipeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src-langchain/ingest/pipeline.ts backend/src-langchain/ingest/pipeline.test.ts
git commit -m "add langgraph ingest pipeline"
```

---

## Milestone 3 — Query graph (corrective RAG)

Each node is a pure async function over a shared state object, unit-tested with mocked models/stores. Task 16 assembles them into a `StateGraph`.

**Shared graph state (defined in `graph.ts`, Task 16; referenced by nodes):**

```ts
type QueryState = {
  conversationId: string;
  question: string;
  history: ChatTurn[];
  generateTitle: boolean;
  rewritten: string;       // set by rewrite
  docs: QuerySource[];     // set by retrieve
  relevant: boolean;       // set by grade
  answer: string;          // set by generate/webSearch
  sources: QuerySource[];  // set by generate/webSearch
  title?: string;          // set by title
};
```

Nodes are written as `(state) => Promise<Partial<QueryState>>` so they compose into LangGraph annotations cleanly.

### Task 10: `rewrite` node — standalone query from history

**Files:**
- Create: `backend/src-langchain/query/nodes/rewrite.ts`
- Test: `backend/src-langchain/query/nodes/rewrite.test.ts`

**Interfaces:**
- Consumes: `makeChatModel` (Task 6); `ChatTurn`.
- Produces: `rewrite(state): Promise<{ rewritten: string }>` — uses history to resolve follow-ups; with empty history, returns the question unchanged (skip the LLM call).

- [ ] **Step 1: Write the failing test:**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn(async () => ({ content: "What is the second budget item?" }));
vi.mock("../../shared/models.js", () => ({ makeChatModel: () => ({ invoke }) }));

describe("rewrite node", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the question unchanged when there is no history", async () => {
    const { rewrite } = await import("./rewrite.js");
    const out = await rewrite({ question: "hi", history: [] } as never);
    expect(out.rewritten).toBe("hi");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rewrites a follow-up using history", async () => {
    const { rewrite } = await import("./rewrite.js");
    const out = await rewrite({
      question: "what about the second one?",
      history: [{ role: "user", content: "list the budget items" }],
    } as never);
    expect(out.rewritten).toContain("second budget item");
    expect(invoke).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail.** Run: `cd backend && npx vitest run src-langchain/query/nodes/rewrite.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `rewrite.ts`:**

```ts
import { makeChatModel } from "../../shared/models.js";
import type { ChatTurn } from "../../../src/rag/types.js";

export async function rewrite(state: {
  question: string;
  history: ChatTurn[];
}): Promise<{ rewritten: string }> {
  if (!state.history?.length) return { rewritten: state.question };
  const transcript = state.history.map((t) => `${t.role}: ${t.content}`).join("\n");
  const res = await makeChatModel().invoke([
    {
      role: "system",
      content:
        "Rewrite the user's question as a standalone search query using the prior conversation for context. Return only the rewritten query.",
    },
    { role: "user", content: `Conversation:\n${transcript}\n\nQuestion: ${state.question}` },
  ]);
  const text = typeof res.content === "string" ? res.content : state.question;
  return { rewritten: text.trim() || state.question };
}
```

- [ ] **Step 4: Run the test and watch it pass.** Run: `cd backend && npx vitest run src-langchain/query/nodes/rewrite.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit.** `git add backend/src-langchain/query/nodes/rewrite.* && git commit -m "add rewrite query node"`

### Task 11: `retrieve` node — Qdrant search scoped to the conversation

**Files:**
- Create: `backend/src-langchain/query/nodes/retrieve.ts`
- Test: `backend/src-langchain/query/nodes/retrieve.test.ts`

**Interfaces:**
- Consumes: `getVectorStore` (Task 7).
- Produces: `retrieve(state): Promise<{ docs: QuerySource[] }>` — `similaritySearch(rewritten, 5, { conversationId })`, mapped to `QuerySource` via each doc's metadata.

- [ ] **Step 1: Write the failing test:**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const similaritySearch = vi.fn(async () => [
  { pageContent: "chunk text", metadata: { filename: "doc.pdf", chunkIndex: 2 } },
]);
vi.mock("../../shared/qdrant.js", () => ({
  getVectorStore: vi.fn(async () => ({ similaritySearch })),
}));

describe("retrieve node", () => {
  beforeEach(() => vi.clearAllMocks());

  it("searches scoped to the conversation and maps to sources", async () => {
    const { retrieve } = await import("./retrieve.js");
    const out = await retrieve({ rewritten: "q", conversationId: "c1" } as never);
    expect(out.docs[0]).toEqual({ filename: "doc.pdf", chunkIndex: 2, text: "chunk text" });
    const [, k, filter] = similaritySearch.mock.calls[0];
    expect(k).toBe(5);
    expect(JSON.stringify(filter)).toContain("c1");
  });
});
```

- [ ] **Step 2: Run it and watch it fail.** Run: `cd backend && npx vitest run src-langchain/query/nodes/retrieve.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `retrieve.ts`** (confirm the exact Qdrant payload-filter shape `@langchain/qdrant` expects via context7 — it wraps metadata under a `metadata.` path):

```ts
import { getVectorStore } from "../../shared/qdrant.js";
import type { QuerySource } from "../../../src/rag/types.js";

export async function retrieve(state: {
  rewritten: string;
  conversationId: string;
}): Promise<{ docs: QuerySource[] }> {
  const store = await getVectorStore();
  const filter = { must: [{ key: "metadata.conversationId", match: { value: state.conversationId } }] };
  const hits = await store.similaritySearch(state.rewritten, 5, filter);
  const docs = hits.map((h) => ({
    filename: String(h.metadata?.filename ?? ""),
    chunkIndex: Number(h.metadata?.chunkIndex ?? 0),
    text: h.pageContent,
  }));
  return { docs };
}
```

- [ ] **Step 4: Run the test and watch it pass.** Run: `cd backend && npx vitest run src-langchain/query/nodes/retrieve.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit.** `git add backend/src-langchain/query/nodes/retrieve.* && git commit -m "add retrieve node"`

### Task 12: `grade` node — relevance gate

**Files:**
- Create: `backend/src-langchain/query/nodes/grade.ts`
- Test: `backend/src-langchain/query/nodes/grade.test.ts`

**Interfaces:**
- Consumes: `makeChatModel` (Task 6).
- Produces: `grade(state): Promise<{ relevant: boolean }>` — `false` immediately if `docs` is empty; otherwise an LLM yes/no on whether the chunks answer `question`. On LLM error, degrade to `relevant: false` (forces web fallback rather than failing).

- [ ] **Step 1: Write the failing test:**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("../../shared/models.js", () => ({ makeChatModel: () => ({ invoke }) }));

describe("grade node", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is not relevant when there are no docs (no LLM call)", async () => {
    const { grade } = await import("./grade.js");
    const out = await grade({ question: "q", docs: [] } as never);
    expect(out.relevant).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("is relevant when the model answers yes", async () => {
    invoke.mockResolvedValueOnce({ content: "yes" });
    const { grade } = await import("./grade.js");
    const out = await grade({ question: "q", docs: [{ filename: "d", chunkIndex: 0, text: "t" }] } as never);
    expect(out.relevant).toBe(true);
  });

  it("degrades to not-relevant when the model errors", async () => {
    invoke.mockRejectedValueOnce(new Error("llm down"));
    const { grade } = await import("./grade.js");
    const out = await grade({ question: "q", docs: [{ filename: "d", chunkIndex: 0, text: "t" }] } as never);
    expect(out.relevant).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail.** Run: `cd backend && npx vitest run src-langchain/query/nodes/grade.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `grade.ts`:**

```ts
import { makeChatModel } from "../../shared/models.js";
import type { QuerySource } from "../../../src/rag/types.js";

export async function grade(state: {
  question: string;
  docs: QuerySource[];
}): Promise<{ relevant: boolean }> {
  if (!state.docs?.length) return { relevant: false };
  try {
    const context = state.docs.map((d) => d.text).join("\n---\n");
    const res = await makeChatModel().invoke([
      {
        role: "system",
        content:
          "Do the provided document chunks contain enough information to answer the question? Reply with exactly 'yes' or 'no'.",
      },
      { role: "user", content: `Question: ${state.question}\n\nChunks:\n${context}` },
    ]);
    const text = (typeof res.content === "string" ? res.content : "").toLowerCase();
    return { relevant: text.includes("yes") };
  } catch {
    return { relevant: false };
  }
}
```

- [ ] **Step 4: Run the test and watch it pass.** Run: `cd backend && npx vitest run src-langchain/query/nodes/grade.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit.** `git add backend/src-langchain/query/nodes/grade.* && git commit -m "add grade node"`

### Task 13: `generate` node — answer from docs

**Files:**
- Create: `backend/src-langchain/query/nodes/generate.ts`
- Test: `backend/src-langchain/query/nodes/generate.test.ts`

**Interfaces:**
- Consumes: `makeChatModel` (Task 6).
- Produces: `generate(state): Promise<{ answer: string; sources: QuerySource[] }>` — answers grounded in `state.docs`; `sources` = the docs used.

- [ ] **Step 1: Write the failing test:**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn(async () => ({ content: "The answer is 42." }));
vi.mock("../../shared/models.js", () => ({ makeChatModel: () => ({ invoke }) }));

describe("generate node", () => {
  beforeEach(() => vi.clearAllMocks());
  it("answers from docs and returns them as sources", async () => {
    const docs = [{ filename: "d.pdf", chunkIndex: 0, text: "42 is the answer" }];
    const { generate } = await import("./generate.js");
    const out = await generate({ question: "answer?", docs } as never);
    expect(out.answer).toBe("The answer is 42.");
    expect(out.sources).toEqual(docs);
  });
});
```

- [ ] **Step 2: Run it and watch it fail.** Run: `cd backend && npx vitest run src-langchain/query/nodes/generate.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `generate.ts`:**

```ts
import { makeChatModel } from "../../shared/models.js";
import type { QuerySource } from "../../../src/rag/types.js";

export async function generate(state: {
  question: string;
  docs: QuerySource[];
}): Promise<{ answer: string; sources: QuerySource[] }> {
  const context = state.docs.map((d, i) => `[${i + 1}] ${d.text}`).join("\n\n");
  const res = await makeChatModel().invoke([
    {
      role: "system",
      content: "Answer the question using only the provided context. Be concise.",
    },
    { role: "user", content: `Context:\n${context}\n\nQuestion: ${state.question}` },
  ]);
  const answer = typeof res.content === "string" ? res.content : "";
  return { answer, sources: state.docs };
}
```

- [ ] **Step 4: Run the test and watch it pass.** Run: `cd backend && npx vitest run src-langchain/query/nodes/generate.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit.** `git add backend/src-langchain/query/nodes/generate.* && git commit -m "add generate node"`

### Task 14: `webSearch` node — fallback when docs are weak

**Files:**
- Create: `backend/src-langchain/query/nodes/webSearch.ts`
- Test: `backend/src-langchain/query/nodes/webSearch.test.ts`

**Interfaces:**
- Consumes: `makeChatModel({ webSearch: true })` (Task 6).
- Produces: `webSearch(state): Promise<{ answer: string; sources: QuerySource[] }>` — answer via the web-search-enabled model; `sources` is `[]` (web answers carry no doc sources).

- [ ] **Step 1: Write the failing test:**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn(async () => ({ content: "Today's weather is sunny." }));
const makeChatModel = vi.fn(() => ({ invoke }));
vi.mock("../../shared/models.js", () => ({ makeChatModel }));

describe("webSearch node", () => {
  beforeEach(() => vi.clearAllMocks());
  it("answers via the web-search model with empty sources", async () => {
    const { webSearch } = await import("./webSearch.js");
    const out = await webSearch({ question: "weather today?" } as never);
    expect(out.answer).toContain("sunny");
    expect(out.sources).toEqual([]);
    expect(makeChatModel).toHaveBeenCalledWith({ webSearch: true });
  });
});
```

- [ ] **Step 2: Run it and watch it fail.** Run: `cd backend && npx vitest run src-langchain/query/nodes/webSearch.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `webSearch.ts`:**

```ts
import { makeChatModel } from "../../shared/models.js";
import type { QuerySource } from "../../../src/rag/types.js";

export async function webSearch(state: {
  question: string;
}): Promise<{ answer: string; sources: QuerySource[] }> {
  const res = await makeChatModel({ webSearch: true }).invoke([
    { role: "user", content: state.question },
  ]);
  const answer = typeof res.content === "string" ? res.content : "";
  return { answer, sources: [] };
}
```

- [ ] **Step 4: Run the test and watch it pass.** Run: `cd backend && npx vitest run src-langchain/query/nodes/webSearch.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit.** `git add backend/src-langchain/query/nodes/webSearch.* && git commit -m "add web search fallback node"`

### Task 15: `title` node — first-message title

**Files:**
- Create: `backend/src-langchain/query/nodes/title.ts`
- Test: `backend/src-langchain/query/nodes/title.test.ts`

**Interfaces:**
- Consumes: `makeChatModel` (Task 6).
- Produces: `title(state): Promise<{ title?: string }>` — returns `{}` when `generateTitle` is false; otherwise a short LLM title. On error returns `{}` (chat-routes already falls back to `titleFromQuestion`).

- [ ] **Step 1: Write the failing test:**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn(async () => ({ content: "Budget overview" }));
vi.mock("../../shared/models.js", () => ({ makeChatModel: () => ({ invoke }) }));

describe("title node", () => {
  beforeEach(() => vi.clearAllMocks());
  it("skips when generateTitle is false", async () => {
    const { title } = await import("./title.js");
    const out = await title({ question: "q", generateTitle: false } as never);
    expect(out).toEqual({});
    expect(invoke).not.toHaveBeenCalled();
  });
  it("returns a short title when asked", async () => {
    const { title } = await import("./title.js");
    const out = await title({ question: "explain the budget", generateTitle: true } as never);
    expect(out.title).toBe("Budget overview");
  });
});
```

- [ ] **Step 2: Run it and watch it fail.** Run: `cd backend && npx vitest run src-langchain/query/nodes/title.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `title.ts`:**

```ts
import { makeChatModel } from "../../shared/models.js";

export async function title(state: {
  question: string;
  generateTitle: boolean;
}): Promise<{ title?: string }> {
  if (!state.generateTitle) return {};
  try {
    const res = await makeChatModel().invoke([
      { role: "system", content: "Summarize the user's question as a title of at most 6 words. Return only the title." },
      { role: "user", content: state.question },
    ]);
    const text = (typeof res.content === "string" ? res.content : "").trim();
    return text ? { title: text } : {};
  } catch {
    return {};
  }
}
```

- [ ] **Step 4: Run the test and watch it pass.** Run: `cd backend && npx vitest run src-langchain/query/nodes/title.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit.** `git add backend/src-langchain/query/nodes/title.* && git commit -m "add title node"`

### Task 16: Assemble the query graph

**Files:**
- Create: `backend/src-langchain/query/graph.ts`
- Test: `backend/src-langchain/query/graph.test.ts`

**Interfaces:**
- Consumes: all six nodes (Tasks 10-15).
- Produces: `runQuery(conversationId, question, history, generateTitle): Promise<QueryResult>` — runs rewrite → retrieve → grade → (generate | webSearch) → title and returns `{ answer, sources, title? }`.

- [ ] **Step 1: Write the failing test** (mock the nodes; assert the branch picks generate when relevant and webSearch when not):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./nodes/rewrite.js", () => ({ rewrite: vi.fn(async (s) => ({ rewritten: s.question })) }));
vi.mock("./nodes/retrieve.js", () => ({ retrieve: vi.fn(async () => ({ docs: [{ filename: "d", chunkIndex: 0, text: "t" }] })) }));
const grade = vi.fn(async () => ({ relevant: true }));
vi.mock("./nodes/grade.js", () => ({ grade }));
vi.mock("./nodes/generate.js", () => ({ generate: vi.fn(async () => ({ answer: "from-docs", sources: [{ filename: "d", chunkIndex: 0, text: "t" }] })) }));
vi.mock("./nodes/webSearch.js", () => ({ webSearch: vi.fn(async () => ({ answer: "from-web", sources: [] })) }));
vi.mock("./nodes/title.js", () => ({ title: vi.fn(async () => ({ title: "T" })) }));

describe("runQuery graph", () => {
  beforeEach(() => vi.clearAllMocks());

  it("answers from docs when relevant", async () => {
    grade.mockResolvedValueOnce({ relevant: true });
    const { runQuery } = await import("./graph.js");
    const r = await runQuery("c1", "q", [], true);
    expect(r.answer).toBe("from-docs");
    expect(r.sources).toHaveLength(1);
    expect(r.title).toBe("T");
  });

  it("falls back to web search when not relevant", async () => {
    grade.mockResolvedValueOnce({ relevant: false });
    const { runQuery } = await import("./graph.js");
    const r = await runQuery("c1", "q", [], false);
    expect(r.answer).toBe("from-web");
    expect(r.sources).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail.** Run: `cd backend && npx vitest run src-langchain/query/graph.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `graph.ts`** (confirm the `@langchain/langgraph` `StateGraph`/`Annotation` API against context7 — the channel/annotation syntax changes across versions; the node wiring and conditional edge below reflect the documented pattern):

```ts
import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { rewrite } from "./nodes/rewrite.js";
import { retrieve } from "./nodes/retrieve.js";
import { grade } from "./nodes/grade.js";
import { generate } from "./nodes/generate.js";
import { webSearch } from "./nodes/webSearch.js";
import { title } from "./nodes/title.js";
import type { ChatTurn, QueryResult, QuerySource } from "../../src/rag/types.js";

const State = Annotation.Root({
  conversationId: Annotation<string>(),
  question: Annotation<string>(),
  history: Annotation<ChatTurn[]>(),
  generateTitle: Annotation<boolean>(),
  rewritten: Annotation<string>(),
  docs: Annotation<QuerySource[]>(),
  relevant: Annotation<boolean>(),
  answer: Annotation<string>(),
  sources: Annotation<QuerySource[]>(),
  title: Annotation<string | undefined>(),
});

const graph = new StateGraph(State)
  .addNode("rewrite", rewrite)
  .addNode("retrieve", retrieve)
  .addNode("grade", grade)
  .addNode("generate", generate)
  .addNode("webSearch", webSearch)
  .addNode("title", title)
  .addEdge(START, "rewrite")
  .addEdge("rewrite", "retrieve")
  .addEdge("retrieve", "grade")
  .addConditionalEdges("grade", (s) => (s.relevant ? "generate" : "webSearch"), {
    generate: "generate",
    webSearch: "webSearch",
  })
  .addEdge("generate", "title")
  .addEdge("webSearch", "title")
  .addEdge("title", END)
  .compile();

export async function runQuery(
  conversationId: string,
  question: string,
  history: ChatTurn[],
  generateTitle: boolean,
): Promise<QueryResult> {
  const final = await graph.invoke({ conversationId, question, history, generateTitle });
  return {
    answer: final.answer ?? "",
    sources: final.sources ?? [],
    title: final.title,
  };
}
```

- [ ] **Step 4: Run the test and watch it pass.** Run: `cd backend && npx vitest run src-langchain/query/graph.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit.** `git add backend/src-langchain/query/graph.* && git commit -m "assemble the corrective rag query graph"`

---

## Milestone 4 — Wire the provider and verify end-to-end

### Task 17: `langgraphProvider` — implement the `RagProvider`

**Files:**
- Create: `backend/src-langchain/index.ts`
- Test: `backend/src-langchain/index.test.ts`

**Interfaces:**
- Consumes: `ingest` (Task 9); `runQuery` (Task 16); `requireLanggraphEnv` (Task 6).
- Produces: `langgraphProvider: RagProvider` — positional `queryRag`/`ingestFile` matching `provider.ts`'s expectations.

- [ ] **Step 1: Write the failing test:**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const ingest = vi.fn(async () => ({ status: "ok", chunkCount: 4 }));
const runQuery = vi.fn(async () => ({ answer: "A", sources: [], title: "T" }));
vi.mock("./ingest/pipeline.js", () => ({ ingest }));
vi.mock("./query/graph.js", () => ({ runQuery }));
vi.mock("./shared/models.js", () => ({ requireLanggraphEnv: vi.fn() }));

describe("langgraphProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ingestFile delegates to the pipeline", async () => {
    const { langgraphProvider } = await import("./index.js");
    const r = await langgraphProvider.ingestFile("c1", "d.pdf", Buffer.from("x"), "application/pdf");
    expect(r).toEqual({ status: "ok", chunkCount: 4 });
    expect(ingest).toHaveBeenCalledWith("c1", "d.pdf", expect.any(Buffer), "application/pdf");
  });

  it("queryRag delegates to the graph", async () => {
    const { langgraphProvider } = await import("./index.js");
    const r = await langgraphProvider.queryRag("c1", "q", [], true);
    expect(r.answer).toBe("A");
    expect(runQuery).toHaveBeenCalledWith("c1", "q", [], true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail.** Run: `cd backend && npx vitest run src-langchain/index.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `index.ts`:**

```ts
import { ingest } from "./ingest/pipeline.js";
import { runQuery } from "./query/graph.js";
import { requireLanggraphEnv } from "./shared/models.js";
import type { RagProvider } from "../src/rag/types.js";

export const langgraphProvider: RagProvider = {
  async ingestFile(conversationId, filename, file, mimeType) {
    requireLanggraphEnv();
    return ingest(conversationId, filename, file, mimeType);
  },
  async queryRag(conversationId, question, history, generateTitle) {
    requireLanggraphEnv();
    return runQuery(conversationId, question, history, generateTitle);
  },
};
```

- [ ] **Step 4: Run the test + full suite + typecheck.**

Run: `cd backend && npx vitest run src-langchain/index.test.ts && npm test && npm run typecheck`
Expected: PASS (whole suite green, including the unchanged chat-routes/n8n-client tests).

- [ ] **Step 5: Commit.** `git add backend/src-langchain/index.* && git commit -m "wire the langgraph rag provider"`

### Task 18: Live smoke verification + cutover notes

**Files:**
- Modify: `backend/.env.example` (document the new keys)
- Create: `docs/langgraph-rag-cutover.md` (operator notes)

This task has no unit test — it is a manual integration gate against real services.

- [ ] **Step 1: Document the env keys** — append to `backend/.env.example`:

```
# RAG backend selector: n8n (default) or langgraph
RAG_PROVIDER=n8n
# Required when RAG_PROVIDER=langgraph:
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION_LG=project_rag_chat_lg
OPENAI_API_KEY=
OPENROUTER_API_KEY=
GOTENBERG_URL=http://localhost:3001
```

- [ ] **Step 2: Create the Qdrant collection** `project_rag_chat_lg` (1536-D, Cosine). Prefer letting the first `addDocuments` create it; if your `@langchain/qdrant` version doesn't auto-create, create it via the Qdrant REST API once. Record the exact step in `docs/langgraph-rag-cutover.md`.

- [ ] **Step 3: Smoke test ingest + query locally against real services.** With a local `.env` setting `RAG_PROVIDER=langgraph` and real keys, start the backend (`npm run dev`), then:

```bash
# Upload a small PDF to a conversation, then ask a question about it.
# Expect: upload returns 202 with a chunkCount > 0; the question returns an
# answer with sources whose filename matches the uploaded file.
```

Expected: a documents-grounded answer with non-empty `sources`; an off-document question returns a web-fallback answer with empty `sources`.

- [ ] **Step 4: Write the cutover checklist** in `docs/langgraph-rag-cutover.md`:
  1. Set `RAG_PROVIDER=langgraph` in the target env.
  2. Re-ingest existing attachments into `project_rag_chat_lg` (different collection from n8n's; old docs aren't visible until re-ingested).
  3. Monitor; on any problem, set `RAG_PROVIDER=n8n` to fall straight back.
  4. After a stable burn-in, plan removal of the n8n path (separate change): delete `n8nProvider` wiring, archive the n8n workflows.

- [ ] **Step 5: Commit.** `git add backend/.env.example docs/langgraph-rag-cutover.md && git commit -m "document langgraph rag env and cutover"`

---

## Self-Review (against the spec)

**Spec coverage:**
- Provider seam + global `RAG_PROVIDER`, default n8n → Tasks 1, 3, 4. ✅
- New code in `backend/src-langchain/`, minimal `src/` change → Tasks 2-17 (only `chat-routes.ts:14` + config touched). ✅
- Same models (Gemini read / OpenAI embed / gpt-4o-mini Responses + web_search) → Tasks 6, 13, 14; Global Constraints. ✅
- Fresh Qdrant collection `project_rag_chat_lg` → Tasks 1, 7. ✅
- Ingest: read → chunk → embed → upsert with `{conversationId, filename, chunkIndex}` metadata; PDF + DOCX(→Gotenberg) → Tasks 8, 9. ✅
- Query graph: rewrite → retrieve + grade → branch docs/web → generate + title; same `{answer, sources, title?}` contract → Tasks 10-16. ✅
- Error handling: grade degrades to web on LLM error; title falls back; query 502 path preserved in unchanged chat-routes → Tasks 12, 15; Milestone 1. ✅
- Cutover + re-ingest → Task 18. ✅
- **Deviation (flagged):** spec Section 5 preferred async instant-upload indexing; this plan keeps synchronous ingest for minimal blast radius (see "Scope decision"). Async is a tracked follow-up, not a dropped requirement.
- **Out of scope (correct):** GraphRAG (spec Phase 2), token streaming, per-conversation override, grounding-check — none in this plan.

**Placeholder scan:** every code step shows real code; library-version-sensitive calls carry an explicit "confirm via context7" note rather than a placeholder. No TBDs.

**Type consistency:** `QueryResult`/`QuerySource`/`IngestResult`/`ChatTurn`/`RagProvider` defined once in `types.ts` (Task 2) and imported everywhere; node return shapes match the `QueryState` fields they set; `runQuery`/`ingest` signatures match `langgraphProvider` and the `provider.ts` wrappers (positional, matching `n8n-client.ts`).
