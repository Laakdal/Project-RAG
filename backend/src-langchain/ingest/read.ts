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
