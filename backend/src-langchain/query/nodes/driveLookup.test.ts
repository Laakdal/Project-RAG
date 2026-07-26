import { describe, it, expect, vi, beforeEach } from "vitest";

// LLM keyword extractor: returns phrases + terms as raw JSON (mirrors glm-4.6).
const termsInvoke = vi.fn(async () => ({
  content: '{"phrases":["perjalanan dinas"],"terms":["sppd","jakarta"]}',
}));
const geminiRead = vi.fn(async () => "read document text");
vi.mock("../../shared/models.js", () => ({
  makeIntentModel: () => ({ invoke: termsInvoke }),
  geminiRead,
}));

// The same reader the upload path uses: routes Office formats through Gotenberg
// and everything else straight to the vision model.
const readDocument = vi.fn(async () => "read document text");
vi.mock("../../ingest/read.js", () => ({ readDocument }));

vi.mock("../../shared/content.js", () => ({ extractText: (c: unknown) => String(c) }));
vi.mock("../../shared/log.js", () => ({ logNodeError: vi.fn() }));

const searchFiles = vi.fn();
const downloadFile = vi.fn(async () => ({ buffer: Buffer.from("bytes"), mimeType: "application/pdf" }));
vi.mock("../../library/drive.js", () => ({ searchFiles, downloadFile }));

const listDriveSources = vi.fn();
vi.mock("../../../src/settings/drive-sources.js", () => ({ listDriveSources }));

const getDriveReadCache = vi.fn(
  async (): Promise<{ markdown: string; modifiedTime: string } | undefined> => undefined,
);
const upsertDriveReadCache = vi.fn(async () => {});
vi.mock("../../../src/settings/drive-cache.js", () => ({ getDriveReadCache, upsertDriveReadCache }));

const SOURCE = { name: "acct", clientId: "cid", clientSecret: "sec", refreshToken: "rt" };
const FILE = {
  id: "f1",
  name: "SPPD Jakarta.pdf",
  mimeType: "application/pdf",
  modifiedTime: "2026-07-01T00:00:00Z",
  webUrl: "https://drive/f1",
  size: "1024",
};

describe("driveLookup node", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    termsInvoke.mockResolvedValue({
      content: '{"phrases":["perjalanan dinas"],"terms":["sppd","jakarta"]}',
    });
    listDriveSources.mockReturnValue([SOURCE]);
    searchFiles.mockResolvedValue([FILE]);
    getDriveReadCache.mockResolvedValue(undefined);
  });

  it("returns no docs when no Drive source is configured", async () => {
    listDriveSources.mockReturnValueOnce([]);
    const { driveLookup } = await import("./driveLookup.js");
    const out = await driveLookup({ question: "SPPD Jakarta" });
    expect(out.docs).toEqual([]);
    expect(searchFiles).not.toHaveBeenCalled();
  });

  it("returns no docs when nothing matches", async () => {
    searchFiles.mockResolvedValueOnce([]);
    const { driveLookup } = await import("./driveLookup.js");
    const out = await driveLookup({ question: "unmatched terms here" });
    expect(out.docs).toEqual([]);
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it("builds a fullText/name query from the LLM phrases + terms and reads the top file", async () => {
    const { driveLookup } = await import("./driveLookup.js");
    const out = await driveLookup({ question: "cari SPPD Jakarta" });

    const q = searchFiles.mock.calls[0][1] as string;
    expect(q).toContain("fullText contains 'perjalanan dinas'");
    expect(q).toContain("fullText contains 'sppd' or name contains 'sppd'");
    expect(q).toContain("trashed = false");

    expect(readDocument).toHaveBeenCalledTimes(1);
    expect(upsertDriveReadCache).toHaveBeenCalledWith(
      expect.objectContaining({ driveFileId: "f1", modifiedTime: FILE.modifiedTime, markdown: "read document text" }),
    );
    expect(out.docs).toEqual([
      { filename: "SPPD Jakarta.pdf", chunkIndex: 0, text: "read document text", webUrl: "https://drive/f1" },
    ]);
  });

  it("serves from cache without reading when markdown is fresh (modifiedTime matches)", async () => {
    getDriveReadCache.mockResolvedValueOnce({ markdown: "cached markdown", modifiedTime: FILE.modifiedTime });
    const { driveLookup } = await import("./driveLookup.js");
    const out = await driveLookup({ question: "SPPD Jakarta" });
    expect(readDocument).not.toHaveBeenCalled();
    expect(downloadFile).not.toHaveBeenCalled();
    expect(out.docs[0].text).toBe("cached markdown");
  });

  it("re-reads when the cached copy is stale (modifiedTime differs)", async () => {
    getDriveReadCache.mockResolvedValueOnce({ markdown: "old", modifiedTime: "2020-01-01T00:00:00Z" });
    const { driveLookup } = await import("./driveLookup.js");
    const out = await driveLookup({ question: "SPPD Jakarta" });
    expect(readDocument).toHaveBeenCalledTimes(1);
    expect(out.docs[0].text).toBe("read document text");
  });

  it("skips files over the 20 MB size cap", async () => {
    searchFiles.mockResolvedValueOnce([{ ...FILE, size: String(25 * 1024 * 1024) }]);
    const { driveLookup } = await import("./driveLookup.js");
    const out = await driveLookup({ question: "SPPD Jakarta" });
    expect(readDocument).not.toHaveBeenCalled();
    expect(out.docs).toEqual([]);
  });

  it("skips a file type the reader cannot parse and takes the next best match", async () => {
    // A .drawio scored highest on the filename terms, was downloaded whole, and
    // the vision reader answered 400 — which aborted the entire source, so the
    // readable PDF right behind it was never read.
    searchFiles.mockResolvedValueOnce([
      {
        ...FILE,
        id: "d1",
        name: "SPPD Jakarta.drawio",
        mimeType: "application/vnd.jgraph.mxfile",
        webUrl: "https://drive/d1",
      },
      FILE,
    ]);
    const { driveLookup } = await import("./driveLookup.js");
    const out = await driveLookup({ question: "cari SPPD Jakarta" });
    expect(out.docs.map((d) => d.filename)).toEqual(["SPPD Jakarta.pdf"]);
  });

  it("skips Google file types that cannot be exported to PDF", async () => {
    // Forms have no PDF export; downloading one answers 400 before the reader is
    // ever reached.
    searchFiles.mockResolvedValueOnce([
      {
        ...FILE,
        id: "g1",
        name: "SPPD Jakarta",
        mimeType: "application/vnd.google-apps.form",
        webUrl: "https://drive/g1",
      },
      FILE,
    ]);
    const { driveLookup } = await import("./driveLookup.js");
    const out = await driveLookup({ question: "cari SPPD Jakarta" });
    expect(out.docs.map((d) => d.filename)).toEqual(["SPPD Jakarta.pdf"]);
    expect(downloadFile).toHaveBeenCalledTimes(1);
  });

  it("still reads Google-native documents, which download as an exported PDF", async () => {
    searchFiles.mockResolvedValueOnce([
      {
        ...FILE,
        id: "g2",
        name: "SPPD Jakarta",
        mimeType: "application/vnd.google-apps.document",
        size: undefined,
      },
    ]);
    const { driveLookup } = await import("./driveLookup.js");
    const out = await driveLookup({ question: "cari SPPD Jakarta" });
    expect(out.docs).toHaveLength(1);
  });

  it("converts an Office file instead of handing it to the vision reader", async () => {
    const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    searchFiles.mockResolvedValueOnce([{ ...FILE, name: "SPPD Jakarta.docx", mimeType: DOCX }]);
    downloadFile.mockResolvedValueOnce({ buffer: Buffer.from("bytes"), mimeType: DOCX });
    const { driveLookup } = await import("./driveLookup.js");
    await driveLookup({ question: "cari SPPD Jakarta" });
    expect(readDocument).toHaveBeenCalledWith(expect.any(Buffer), DOCX);
    expect(geminiRead).not.toHaveBeenCalled();
  });

  it("falls back to the heuristic extractor when the LLM call fails", async () => {
    termsInvoke.mockRejectedValueOnce(new Error("glm down"));
    const { driveLookup } = await import("./driveLookup.js");
    const out = await driveLookup({ question: "laporan keuangan jakarta" });
    // The query is still built (from heuristic keywords) and the file is read.
    const q = searchFiles.mock.calls[0][1] as string;
    expect(q).toContain("name contains 'jakarta'");
    expect(out.docs).toHaveLength(1);
  });

  it("reads the top match from each configured source (Option 2: top-per-source)", async () => {
    listDriveSources.mockReturnValueOnce([
      SOURCE,
      { name: "acct2", clientId: "c2", clientSecret: "s2", refreshToken: "rt2" },
    ]);
    searchFiles
      .mockResolvedValueOnce([FILE])
      .mockResolvedValueOnce([{ ...FILE, id: "f2", name: "SPPD Bandung.pdf", webUrl: "https://drive/f2" }]);
    const { driveLookup } = await import("./driveLookup.js");
    const out = await driveLookup({ question: "SPPD" });
    expect(searchFiles).toHaveBeenCalledTimes(2);
    expect(out.docs.map((d) => d.filename)).toEqual(["SPPD Jakarta.pdf", "SPPD Bandung.pdf"]);
  });
});
