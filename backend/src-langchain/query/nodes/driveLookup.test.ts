import { describe, it, expect, vi, beforeEach } from "vitest";

const searchFiles = vi.fn();
const downloadFile = vi.fn(async () => ({ buffer: Buffer.from("x"), mimeType: "application/pdf" }));
const geminiRead = vi.fn(async () => "drive doc text");
vi.mock("../../library/drive.js", () => ({ searchFiles, downloadFile }));
vi.mock("../../shared/models.js", () => ({ geminiRead }));
vi.mock("../../../src/settings/drive-sources.js", () => ({
  listDriveSources: () => [{ id: "s1", name: "Acct A", serviceAccountJson: "{}", folderId: "f1", createdAt: "" }],
}));

describe("driveLookup node", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the top Drive match and returns it as a labelled doc", async () => {
    searchFiles.mockResolvedValueOnce([
      { id: "1", name: "SOP.pdf", mimeType: "application/pdf", modifiedTime: "", webUrl: "http://drive/1" },
    ]);
    const { driveLookup } = await import("./driveLookup.js");
    const out = await driveLookup({ question: "apa isi SOP IT Project Management" } as never);
    expect(out.docs).toEqual([
      { filename: "SOP.pdf", chunkIndex: 0, text: "drive doc text", webUrl: "http://drive/1" },
    ]);
    expect(geminiRead).toHaveBeenCalled();
  });

  it("returns no docs when nothing matches", async () => {
    searchFiles.mockResolvedValueOnce([]);
    const { driveLookup } = await import("./driveLookup.js");
    const out = await driveLookup({ question: "unmatched terms here" } as never);
    expect(out.docs).toEqual([]);
    expect(downloadFile).not.toHaveBeenCalled();
  });
});
