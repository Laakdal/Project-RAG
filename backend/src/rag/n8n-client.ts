import { config } from "../config.js";

export type QuerySource = {
  filename: string;
  chunkIndex: number;
  text: string;
};

export type QueryResult = {
  answer: string;
  sources: QuerySource[];
};

export type IngestResult = {
  status: string;
  chunkCount: number;
};

const QUERY_PATH = "/webhook/rag-query";
const INGEST_PATH = "/webhook/rag-ingest";

function url(path: string): string {
  return `${config.N8N_BASE_URL.replace(/\/$/, "")}${path}`;
}

export type ChatTurn = { role: string; content: string };

export async function queryRag(
  conversationId: string,
  question: string,
  history: ChatTurn[] = [],
): Promise<QueryResult> {
  const res = await fetch(url(QUERY_PATH), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, question, history }),
  });
  if (!res.ok) {
    throw new Error(`n8n query failed: ${res.status}`);
  }
  const data = (await res.json()) as Partial<QueryResult>;
  return {
    answer: data.answer ?? "",
    sources: Array.isArray(data.sources) ? data.sources : [],
  };
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

  const res = await fetch(url(INGEST_PATH), { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`n8n ingest failed: ${res.status}`);
  }
  const data = (await res.json()) as Partial<IngestResult>;
  return {
    status: data.status ?? "ok",
    chunkCount: typeof data.chunkCount === "number" ? data.chunkCount : 0,
  };
}
