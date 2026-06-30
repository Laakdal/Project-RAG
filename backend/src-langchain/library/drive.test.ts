import { describe, it, expect, vi, beforeEach } from "vitest";

const list = vi.fn();
const get = vi.fn();
const exportFn = vi.fn();
vi.mock("googleapis", () => ({
  google: {
    auth: { GoogleAuth: class { getClient() { return {}; } } },
    drive: () => ({ files: { list, get, export: exportFn } }),
  },
}));

vi.mock("../../src/config.js", () => ({
  config: { GOOGLE_SERVICE_ACCOUNT_JSON: "{}", DRIVE_FOLDER_ID: "folder1" },
}));

describe("drive client", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists a folder across pages", async () => {
    list
      .mockResolvedValueOnce({
        data: {
          files: [{ id: "a", name: "a.pdf", mimeType: "application/pdf", modifiedTime: "t1", webViewLink: "u" }],
          nextPageToken: "p2",
        },
      })
      .mockResolvedValueOnce({
        data: {
          files: [{ id: "b", name: "b.pdf", mimeType: "application/pdf", modifiedTime: "t2", webViewLink: "u" }],
        },
      });
    const { listFolder } = await import("./drive.js");
    const files = await listFolder("folder1");
    expect(files.map((f) => f.id)).toEqual(["a", "b"]);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("exports google-native files to pdf, downloads others as media", async () => {
    exportFn.mockResolvedValue({ data: new ArrayBuffer(3) });
    get.mockResolvedValue({ data: new ArrayBuffer(3) });
    const { downloadFile } = await import("./drive.js");

    const gdoc = await downloadFile({
      id: "g", name: "n", mimeType: "application/vnd.google-apps.document", modifiedTime: "t", webUrl: "u",
    });
    expect(gdoc.mimeType).toBe("application/pdf");
    expect(exportFn).toHaveBeenCalled();

    const pdf = await downloadFile({
      id: "p", name: "n", mimeType: "application/pdf", modifiedTime: "t", webUrl: "u",
    });
    expect(pdf.mimeType).toBe("application/pdf");
    expect(get).toHaveBeenCalled();
  });
});
