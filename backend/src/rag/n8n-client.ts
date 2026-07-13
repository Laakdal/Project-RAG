import { config } from "../config.js";
import type { QuerySource, QueryResult, IngestResult, ChatTurn } from "./types.js";

const QUERY_PATH = "/webhook/rag-query"; // /webhook/rag-query
const INGEST_PATH = "/webhook/rag-ingest"; // /webhook/rag-ingest
const DRIVE_DOWNLOAD_PATH = "/webhook/drive-download"; // returns raw file bytes

function url(path: string): string {
  return `${config.N8N_BASE_URL.replace(/\/$/, "")}${path}`;
}

export async function queryRag(
  conversationId: string,
  question: string,
  history: ChatTurn[] = [],
  // True only for the first message of a conversation, asking the workflow to
  // also summarize a short title. Defaults false so non-first turns skip it.
  generateTitle = false,
  libraryDocs: QuerySource[] = [],
  // When true, the library already answers the question, so the workflow may
  // skip the slow on-demand live Drive read. Defaults false (do the live read).
  skipDrive = false,
): Promise<QueryResult> {
  const res = await fetch(url(QUERY_PATH), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, question, history, generateTitle, libraryDocs, skipDrive }),
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

// Fetch a Google Drive file's raw bytes via the n8n drive-download webhook. The
// backend has no Drive access, so n8n does the download; used to preview a
// library source (PDF) inline in the chat UI.
export async function downloadDriveFile(
  driveFileId: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(url(DRIVE_DOWNLOAD_PATH), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ driveFileId }),
  });
  if (!res.ok) {
    throw new Error(`n8n drive download failed: ${res.status}`);
  }
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
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
