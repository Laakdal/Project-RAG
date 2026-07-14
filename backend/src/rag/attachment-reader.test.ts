// backend/src/rag/attachment-reader.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMock = vi.hoisted(() => {
  let rows: any[] = [];
  const updates: any[] = [];
  return {
    setRows: (r: any[]) => (rows = r),
    updates,
    reset: () => { rows = []; updates.length = 0; },
    select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }),
    update: () => ({ set: (v: any) => ({ where: async () => { updates.push(v); } }) }),
  };
});
vi.mock("../db/index.js", () => ({ db: dbMock }));
vi.mock("../db/schema.js", () => ({ attachments: {} }));
vi.mock("drizzle-orm", () => ({ eq: () => ({}) }));
const readFileMock = vi.hoisted(() => vi.fn());
vi.mock("./n8n-client.js", () => ({ readFile: readFileMock }));
const extractPdfMock = vi.hoisted(() => vi.fn());
vi.mock("./pdf-extract.js", () => ({ extractPdfHybrid: extractPdfMock }));

// Default: the hybrid PDF extractor "can't run" (null) so runRead falls back to
// the whole-file readFile path; individual tests override as needed.
beforeEach(() => {
  dbMock.reset();
  readFileMock.mockReset();
  extractPdfMock.mockReset();
  extractPdfMock.mockResolvedValue(null);
});

it("ensureExtractedText returns cached text when ready", async () => {
  dbMock.setRows([{ status: "ready", extractedText: "# body" }]);
  const { ensureExtractedText } = await import("./attachment-reader.js");
  expect(await ensureExtractedText("a1")).toBe("# body");
  expect(readFileMock).not.toHaveBeenCalled();
});

it("ensureExtractedText returns null when failed", async () => {
  dbMock.setRows([{ status: "failed", extractedText: null }]);
  const { ensureExtractedText } = await import("./attachment-reader.js");
  expect(await ensureExtractedText("a1")).toBeNull();
});

it("runRead caches text and marks ready on success", async () => {
  dbMock.setRows([{ filename: "a.pdf", mimeType: "application/pdf", data: Buffer.from("x") }]);
  readFileMock.mockResolvedValue({ text: "# read" });
  const { runRead } = await import("./attachment-reader.js");
  await runRead("a1");
  expect(dbMock.updates).toContainEqual({ extractedText: "# read", status: "ready" });
});

it("runRead uses the hybrid PDF extractor and skips the whole-file read", async () => {
  dbMock.setRows([{ filename: "book.pdf", mimeType: "application/pdf", data: Buffer.from("x") }]);
  extractPdfMock.mockResolvedValue("# extracted locally");
  const { runRead } = await import("./attachment-reader.js");
  await runRead("a1");
  expect(extractPdfMock).toHaveBeenCalled();
  expect(readFileMock).not.toHaveBeenCalled();
  expect(dbMock.updates).toContainEqual({ extractedText: "# extracted locally", status: "ready" });
});

it("runRead marks failed when the read returns empty", async () => {
  dbMock.setRows([{ filename: "a.pdf", mimeType: "application/pdf", data: Buffer.from("x") }]);
  readFileMock.mockResolvedValue({ text: "  " });
  const { runRead } = await import("./attachment-reader.js");
  await runRead("a1");
  expect(dbMock.updates).toContainEqual({ status: "failed" });
});
