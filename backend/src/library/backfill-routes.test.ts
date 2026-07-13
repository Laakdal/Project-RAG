import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { buildTestApp } from "../test/app-harness.js";

const { cfg } = vi.hoisted(() => ({
  cfg: { LIBRARY_INDEX_TOKEN: "secret" as string | undefined },
}));
vi.mock("../config.js", () => ({ config: cfg }));

const indexDriveSource = vi.fn(async () => {});
vi.mock("./drive-index.js", () => ({ indexDriveSource }));

const existsBySourceRef = vi.fn(async () => false);
const listIndexedDriveRefs = vi.fn(async () => ["file-a", "file-b"]);
vi.mock("./repo.js", () => ({ existsBySourceRef, listIndexedDriveRefs }));

const { libraryBackfillRouter } = await import("./backfill-routes.js");
const app = () => buildTestApp((a) => a.use("/library", libraryBackfillRouter));
const TOKEN = "secret";

describe("library backfill routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cfg.LIBRARY_INDEX_TOKEN = "secret";
    existsBySourceRef.mockResolvedValue(false);
  });

  it("rejects requests with no/invalid token", async () => {
    expect((await request(app()).get("/library/drive-refs")).status).toBe(401);
    expect(
      (await request(app()).get("/library/drive-refs").set("x-index-token", "wrong")).status,
    ).toBe(401);
  });

  it("503s when the token is not configured", async () => {
    cfg.LIBRARY_INDEX_TOKEN = undefined;
    const res = await request(app()).get("/library/drive-refs").set("x-index-token", "anything");
    expect(res.status).toBe(503);
  });

  it("returns already-indexed drive refs", async () => {
    const res = await request(app()).get("/library/drive-refs").set("x-index-token", TOKEN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ refs: ["file-a", "file-b"] });
  });

  it("indexes a new drive document", async () => {
    const res = await request(app())
      .post("/library/index-drive")
      .set("x-index-token", TOKEN)
      .send({ driveFileId: "d1", filename: "trip.pdf", text: "SPPD ke Jakarta" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "indexed", driveFileId: "d1" });
    expect(indexDriveSource).toHaveBeenCalledWith({
      driveFileId: "d1",
      filename: "trip.pdf",
      text: "SPPD ke Jakarta",
    });
  });

  it("skips a document that is already indexed", async () => {
    existsBySourceRef.mockResolvedValueOnce(true);
    const res = await request(app())
      .post("/library/index-drive")
      .set("x-index-token", TOKEN)
      .send({ driveFileId: "d1", filename: "trip.pdf", text: "SPPD ke Jakarta" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "skipped", driveFileId: "d1" });
    expect(indexDriveSource).not.toHaveBeenCalled();
  });

  it("400s on missing driveFileId or empty text", async () => {
    const res = await request(app())
      .post("/library/index-drive")
      .set("x-index-token", TOKEN)
      .send({ driveFileId: "d1", text: "   " });
    expect(res.status).toBe(400);
    expect(indexDriveSource).not.toHaveBeenCalled();
  });
});
