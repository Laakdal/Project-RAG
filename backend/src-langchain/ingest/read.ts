import { geminiRead } from "../shared/models.js";
import { config } from "../../src/config.js";

// Office formats that LibreOffice/Gotenberg can convert to PDF. They can't go
// straight to the Gemini API, so they take a Gotenberg hop first. PDF, images,
// and plain text go directly to Gemini's multimodal reader (which OCRs scans).
const OFFICE_MIME = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // xlsx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // pptx
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
]);

async function officeToPdf(file: Buffer, mimeType: string, filename = "in"): Promise<Buffer> {
  if (!config.GOTENBERG_URL) throw new Error("GOTENBERG_URL required for Office files");
  const form = new FormData();
  form.append("files", new Blob([file], { type: mimeType }), filename);
  const res = await fetch(
    `${config.GOTENBERG_URL.replace(/\/$/, "")}/forms/libreoffice/convert`,
    { method: "POST", body: form },
  );
  if (!res.ok) throw new Error(`gotenberg convert failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function readDocument(file: Buffer, mimeType: string): Promise<string> {
  if (OFFICE_MIME.has(mimeType)) {
    const pdf = await officeToPdf(file, mimeType);
    return geminiRead(pdf, "application/pdf");
  }
  return geminiRead(file, mimeType);
}
