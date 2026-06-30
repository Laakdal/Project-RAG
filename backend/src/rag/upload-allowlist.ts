// The set of upload types the RAG ingest pipeline can read. Kept in its own
// module so the predicate is unit-testable without spinning up the route.
export const ALLOWED_MIME = new Set<string>([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // DOCX
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // XLSX
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // PPTX
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

// Browsers are unreliable about the MIME they attach to text-ish files
// (.md/.csv/.json often arrive as "" or application/octet-stream), so we also
// accept by extension. This mirrors the frontend's isFileTypeSupported.
export const ALLOWED_EXTENSIONS = new Set<string>([
  "pdf", "docx", "xlsx", "pptx",
  "png", "jpg", "jpeg", "webp",
  "txt", "md", "csv", "json",
]);

export function isAllowedUpload(mimetype: string, filename: string): boolean {
  if (ALLOWED_MIME.has(mimetype)) return true;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return ALLOWED_EXTENSIONS.has(ext);
}
