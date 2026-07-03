import { config } from "../config.js";

export type QuerySource = {
  filename: string;
  chunkIndex: number;
  text: string;
  origin?: string;
  driveFileId?: string;
};

export type QueryResult = {
  answer: string;
  sources: QuerySource[];
  // Present only when the workflow was asked to summarize a title (first
  // message of a conversation). Optional because the query workflow doesn't
  // emit it yet; the backend falls back to a heuristic when it's absent.
  title?: string;
};

export type IngestResult = {
  status: string;
  chunkCount: number;
};

const QUERY_TIMEOUT_MS = 150_000;  // answer generation incl. slow first-time on-demand Drive reads (+ optional web search)
const READ_TIMEOUT_MS = 120_000;   // background Gemini read of a large/image-heavy doc
const INGEST_TIMEOUT_MS = 120_000; // legacy ingest (read+chunk+embed); now unused but bounded for safety

const QUERY_PATH = "/webhook/rag-query";
const INGEST_PATH = "/webhook/rag-ingest";
const READ_PATH = "/webhook/rag-read";

function url(path: string): string {
  return `${config.N8N_BASE_URL.replace(/\/$/, "")}${path}`;
}

export type ChatTurn = { role: string; content: string };

export async function queryRag(
  conversationId: string,
  question: string,
  history: ChatTurn[] = [],
  // True only for the first message of a conversation, asking the workflow to
  // also summarize a short title. Defaults false so non-first turns skip it.
  generateTitle = false,
  // Inline document texts from per-chat uploads. The query workflow will
  // inject these into the prompt context alongside retrieved chunks.
  docs: { filename: string; text: string }[] = [],
  // Docs retrieved from the shared vector library (intent-gated).
  libraryDocs: QuerySource[] = [],
): Promise<QueryResult> {
  const res = await fetch(url(QUERY_PATH), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, question, history, generateTitle, docs, libraryDocs }),
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`n8n query failed: ${res.status}`);
  }
  const data = (await res.json()) as Partial<QueryResult>;
  return {
    answer: data.answer ?? "",
    sources: Array.isArray(data.sources) ? data.sources : [],
    // Only surface a non-empty string title; the workflow may omit it.
    title: typeof data.title === "string" ? data.title : undefined,
  };
}

export async function readFile(
  filename: string,
  file: Buffer,
  mimeType: string,
): Promise<{ text: string }> {
  const form = new FormData();
  form.append("filename", filename);
  // Wrap the buffer as a Blob so multipart sends the binary with a filename.
  form.append("file", new Blob([file], { type: mimeType }), filename);
  const res = await fetch(url(READ_PATH), { method: "POST", body: form, signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`n8n read failed: ${res.status}`);
  }
  const data = (await res.json()) as Partial<{ text: string }>;
  return { text: typeof data.text === "string" ? data.text : "" };
}

export async function ingestFile(
  conversationId: string,
  filename: string,
  file: Buffer,
  mimeType: string,
): Promise<IngestResult> {
  const form = new FormData();
  form.append("conversationId", conversationId);
  form.append("filename", filename);
  // Wrap the buffer as a Blob so multipart sends the binary with a filename.
  form.append("file", new Blob([file], { type: mimeType }), filename);

  const res = await fetch(url(INGEST_PATH), { method: "POST", body: form, signal: AbortSignal.timeout(INGEST_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`n8n ingest failed: ${res.status}`);
  }
  const data = (await res.json()) as Partial<IngestResult>;
  return {
    status: data.status ?? "ok",
    chunkCount: typeof data.chunkCount === "number" ? data.chunkCount : 0,
  };
}
