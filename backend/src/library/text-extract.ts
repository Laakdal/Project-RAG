import { config } from "../config.js";

const READ_PATH = "/webhook/rag-read";

export async function extractText(
  file: Buffer,
  filename: string,
  mimeType: string,
): Promise<string> {
  const url = `${config.N8N_BASE_URL.replace(/\/$/, "")}${READ_PATH}`;
  const form = new FormData();
  form.append("filename", filename);
  form.append("file", new Blob([file], { type: mimeType }), filename);

  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`n8n rag-read failed: ${res.status}`);
  }
  const data = (await res.json()) as { text?: string };
  return typeof data.text === "string" ? data.text : "";
}
