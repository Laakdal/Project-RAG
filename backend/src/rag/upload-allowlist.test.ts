import { describe, it, expect } from "vitest";
import { isAllowedUpload } from "./upload-allowlist.js";

describe("isAllowedUpload", () => {
  it("accepts the existing types by MIME", () => {
    expect(isAllowedUpload("application/pdf", "a.pdf")).toBe(true);
    expect(
      isAllowedUpload(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "a.docx",
      ),
    ).toBe(true);
  });

  it("accepts the new office/image/text types by MIME", () => {
    expect(
      isAllowedUpload(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "a.xlsx",
      ),
    ).toBe(true);
    expect(
      isAllowedUpload(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "a.pptx",
      ),
    ).toBe(true);
    expect(isAllowedUpload("image/png", "a.png")).toBe(true);
    expect(isAllowedUpload("image/webp", "a.webp")).toBe(true);
    expect(isAllowedUpload("text/csv", "a.csv")).toBe(true);
    expect(isAllowedUpload("application/json", "a.json")).toBe(true);
    expect(isAllowedUpload("image/jpeg", "a.jpg")).toBe(true);
    expect(isAllowedUpload("text/plain", "a.txt")).toBe(true);
    expect(isAllowedUpload("text/markdown", "a.md")).toBe(true);
  });

  it("falls back to the extension when the browser MIME is empty or octet-stream", () => {
    // browsers frequently send "" or application/octet-stream for .md/.csv/.json
    expect(isAllowedUpload("", "notes.md")).toBe(true);
    expect(isAllowedUpload("application/octet-stream", "data.csv")).toBe(true);
  });

  it("rejects genuinely unsupported types by both MIME and extension", () => {
    expect(isAllowedUpload("application/zip", "archive.zip")).toBe(false);
    expect(isAllowedUpload("application/x-msdownload", "malware.exe")).toBe(false);
    expect(isAllowedUpload("application/octet-stream", "evil.exe")).toBe(false);
    expect(isAllowedUpload("text/html", "page.html")).toBe(false);
  });
});
