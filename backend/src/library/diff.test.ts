import { describe, it, expect } from "vitest";
import { classifyFiles } from "./diff.js";

const f = (id: string, modifiedTime: string) => ({
  id,
  name: id,
  mimeType: "application/pdf",
  modifiedTime,
  webUrl: "u",
});

describe("classifyFiles", () => {
  it("indexes new and changed, skips unchanged, removes deleted", () => {
    const drive = [f("a", "t1"), f("b", "t2new"), f("c", "t3")];
    const indexed = [
      { driveFileId: "b", modifiedTime: "t2old" }, // changed
      { driveFileId: "c", modifiedTime: "t3" }, // unchanged
      { driveFileId: "d", modifiedTime: "t4" }, // deleted from drive
    ];
    const { toIndex, toRemove } = classifyFiles(drive, indexed);
    expect(toIndex.map((x) => x.id).sort()).toEqual(["a", "b"]); // a new, b changed
    expect(toRemove).toEqual(["d"]);
  });
});
