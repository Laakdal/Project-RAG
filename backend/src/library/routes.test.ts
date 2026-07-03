import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { buildTestApp } from "../test/app-harness.js";

vi.mock("../auth/middleware.js", () => ({
  requireAuth: (_q: unknown, _s: unknown, n: () => void) => n(),
  requireAdmin: (_q: unknown, _s: unknown, n: () => void) => n(),
}));
vi.mock("../auth/csrf.js", () => ({ requireCsrf: (_q: unknown, _s: unknown, n: () => void) => n() }));

const indexUpload = vi.fn(async () => ({ id: "doc-1", status: "indexed", chunkCount: 3 }));
vi.mock("./ingest.js", () => ({ indexUpload }));

const listIndexed = vi.fn(async () => [{ id: "doc-1", filename: "a.pdf" }]);
const deleteDocument = vi.fn(async () => {});
const summary = vi.fn(async () => ({ total: 1, failed: 0, lastIndexedAt: null }));
vi.mock("./repo.js", () => ({ listIndexed, deleteDocument, summary }));

const deleteBySource = vi.fn(async () => {});
vi.mock("./vector-store.js", () => ({ deleteBySource }));

const { libraryRouter } = await import("./routes.js");
const app = () => buildTestApp((a) => a.use("/library", libraryRouter));

describe("library routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uploads a document and returns its id", async () => {
    const res = await request(app())
      .post("/library/documents")
      .attach("file", Buffer.from("hello"), { filename: "a.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ id: "doc-1", status: "indexed", chunkCount: 3 });
    expect(indexUpload).toHaveBeenCalled();
  });

  it("rejects an unsupported file type", async () => {
    const res = await request(app())
      .post("/library/documents")
      .attach("file", Buffer.from("x"), { filename: "a.exe", contentType: "application/x-msdownload" });
    expect(res.status).toBe(400);
    expect(indexUpload).not.toHaveBeenCalled();
  });

  it("lists documents", async () => {
    const res = await request(app()).get("/library/documents");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("deletes a document from Qdrant and Postgres", async () => {
    const res = await request(app()).delete("/library/documents/doc-1");
    expect(res.status).toBe(204);
    expect(deleteBySource).toHaveBeenCalledWith("doc-1");
    expect(deleteDocument).toHaveBeenCalledWith("doc-1");
  });
});
