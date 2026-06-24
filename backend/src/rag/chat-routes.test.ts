import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { buildTestApp, makeDbMock, TEST_USER_ID } from "../test/app-harness.js";

const dbMock = makeDbMock();
vi.mock("../db/index.js", () => ({ db: dbMock.db }));
vi.mock("../auth/csrf.js", () => ({
  requireCsrf: (_req: unknown, _res: unknown, next: () => void) => next(),
  CSRF_HEADER_NAME: "x-csrf-token",
}));

vi.mock("./n8n-client.js", () => ({
  queryRag: vi.fn(async () => ({
    answer: "42",
    sources: [{ filename: "doc.pdf", chunkIndex: 1, text: "the answer is 42" }],
  })),
  ingestFile: vi.fn(async () => ({ status: "ok", chunkCount: 3 })),
}));

// These resolve to the mocked fns above; override per-test with vi.mocked(...).
import { queryRag, ingestFile } from "./n8n-client.js";

// Imported after mocks are registered.
const { chatRouter } = await import("./chat-routes.js");

function app() {
  return buildTestApp((a) => a.use("/chat", chatRouter));
}

// Walk a Drizzle SQL condition and collect the raw text from its StringChunk
// nodes. Used to assert which literals a built WHERE clause contains without
// stringifying the (circular) column references inside it.
function sqlLiterals(node: unknown, seen = new Set<unknown>()): string[] {
  if (node == null || typeof node !== "object" || seen.has(node)) return [];
  seen.add(node);
  const out: string[] = [];
  const obj = node as Record<string, unknown>;
  if (obj.constructor?.name === "StringChunk" && Array.isArray(obj.value)) {
    out.push(...obj.value.filter((v): v is string => typeof v === "string"));
  }
  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) for (const item of v) out.push(...sqlLiterals(item, seen));
    else if (v && typeof v === "object") out.push(...sqlLiterals(v, seen));
  }
  return out;
}

// The db mock and n8n mocks are module-level, so clear call history before
// each test to keep per-test call-count/argument assertions reliable.
// clearAllMocks resets call history only; implementations and the db mock's
// setResult state are preserved.
beforeEach(() => {
  vi.clearAllMocks();
});

describe("conversation routes", () => {
  it("creates a conversation owned by the session user", async () => {
    dbMock.setResult([
      { id: "c1", title: "New chat", createdAt: new Date().toISOString() },
    ]);
    const res = await request(app()).post("/chat/conversations").send({});
    expect(res.status).toBe(201);
    expect(res.body.id).toBe("c1");
  });

  it("lists conversations", async () => {
    dbMock.setResult([{ id: "c1", title: "New chat", createdAt: "t" }]);
    const res = await request(app()).get("/chat/conversations");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("returns 404 for a conversation the user does not own", async () => {
    dbMock.setResult([]); // ownership lookup finds nothing
    const res = await request(app()).get("/chat/conversations/cX/messages");
    expect(res.status).toBe(404);
  });

  it("returns 401 when the request is unauthenticated", async () => {
    const unauthedApp = buildTestApp((a) => a.use("/chat", chatRouter), false);
    const res = await request(unauthedApp).get("/chat/conversations");
    expect(res.status).toBe(401);
  });

  it("returns the message history for an owned conversation", async () => {
    // The ownership lookup and the messages query both read this single
    // result. The row is valid as both an ownership row (truthy id) and a
    // message list entry, so one setResult serves both reads.
    const messageRow = {
      id: "m1",
      role: "user",
      content: "hi",
      sources: null,
      createdAt: "t",
    };
    dbMock.setResult([messageRow]);
    const res = await request(app()).get("/chat/conversations/c1/messages");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toEqual([messageRow]);
  });

  it("lists attachments for an owned conversation", async () => {
    // One result serves both the ownership lookup (truthy id) and the
    // attachments query, matching the message-history test above.
    const attachmentRow = {
      id: "att1",
      filename: "doc.pdf",
      status: "ready",
      chunkCount: 3,
      createdAt: "t",
    };
    dbMock.setResult([attachmentRow]);
    const res = await request(app()).get("/chat/conversations/c1/attachments");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([attachmentRow]);
  });

  it("returns 404 listing attachments for a conversation the user does not own", async () => {
    dbMock.setResult([]); // ownership lookup finds nothing
    const res = await request(app()).get("/chat/conversations/cX/attachments");
    expect(res.status).toBe(404);
  });

  it("excludes failed attachments from the list", async () => {
    // The db mock returns whatever setResult holds, so the route's SQL filter
    // isn't executed in-process. Assert instead that the attachments query is
    // built with a WHERE clause that excludes status 'failed', so legacy failed
    // rows can never reach the response.
    const readyRow = {
      id: "att1",
      filename: "doc.pdf",
      status: "ready",
      chunkCount: 3,
      createdAt: "t",
    };
    dbMock.setResult([readyRow]); // ownership lookup + attachments query
    const whereSpy = dbMock.db.where as ReturnType<typeof vi.fn>;
    const res = await request(app()).get("/chat/conversations/c1/attachments");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([readyRow]);

    // The last WHERE built (the attachments select) carries the failed filter.
    // Drizzle stores raw SQL text in StringChunk nodes; collect those literals
    // (the table-column chunks are circular, so we can't JSON.stringify them).
    const lastWhere = whereSpy.mock.calls[whereSpy.mock.calls.length - 1][0];
    expect(sqlLiterals(lastWhere).join(" ")).toContain("<> 'failed'");
  });
});

describe("delete conversation route", () => {
  it("deletes an owned conversation and returns 204", async () => {
    dbMock.setResult([{ id: "c1" }]); // ownership lookup + delete resolve here
    const res = await request(app()).delete("/chat/conversations/c1");
    expect(res.status).toBe(204);
    const deleteSpy = dbMock.db.delete as ReturnType<typeof vi.fn>;
    expect(deleteSpy).toHaveBeenCalled();
  });

  it("returns 404 when the conversation is not owned", async () => {
    dbMock.setResult([]); // ownership lookup empty
    const res = await request(app()).delete("/chat/conversations/cX");
    expect(res.status).toBe(404);
    const deleteSpy = dbMock.db.delete as ReturnType<typeof vi.fn>;
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});

describe("message route", () => {
  it("rejects an empty question with 400", async () => {
    dbMock.setResult([{ id: "c1" }]); // owned
    const res = await request(app())
      .post("/chat/conversations/c1/messages")
      .send({ question: "" });
    expect(res.status).toBe(400);
  });

  it("answers via n8n and persists both turns", async () => {
    dbMock.setResult([{ id: "c1" }]); // ownership + inserts resolve to this
    const res = await request(app())
      .post("/chat/conversations/c1/messages")
      .send({ question: "What is the answer?" });
    expect(res.status).toBe(200);
    expect(res.body.answer).toBe("42");
    expect(res.body.sources[0]).toEqual({
      filename: "doc.pdf",
      chunkIndex: 1,
      text: "the answer is 42",
    });

    // The query ran with (conversationId, question, history).
    expect(vi.mocked(queryRag)).toHaveBeenCalledWith(
      "c1",
      "What is the answer?",
      expect.any(Array),
    );

    // Both turns were persisted in order: the user message first, then the
    // assistant answer with its sources. (Because the query runs before either
    // insert, this also confirms nothing is written until the answer succeeds.)
    const valuesSpy = dbMock.db.values as ReturnType<typeof vi.fn>;
    expect(valuesSpy.mock.calls[0][0]).toEqual({
      conversationId: "c1",
      role: "user",
      content: "What is the answer?",
    });
    expect(valuesSpy.mock.calls[1][0]).toEqual({
      conversationId: "c1",
      role: "assistant",
      content: "42",
      sources: [{ filename: "doc.pdf", chunkIndex: 1, text: "the answer is 42" }],
    });
  });

  it("returns 502 when n8n is unavailable", async () => {
    dbMock.setResult([{ id: "c1" }]); // owned
    vi.mocked(queryRag).mockRejectedValueOnce(new Error("n8n down"));
    const res = await request(app())
      .post("/chat/conversations/c1/messages")
      .send({ question: "What is the answer?" });
    expect(res.status).toBe(502);
  });

  it("returns 404 when the conversation is not owned", async () => {
    dbMock.setResult([]); // ownership lookup empty
    const res = await request(app())
      .post("/chat/conversations/cX/messages")
      .send({ question: "hi" });
    expect(res.status).toBe(404);
  });
});

describe("attachment route", () => {
  it("rejects a non-PDF/DOCX file with 400", async () => {
    dbMock.setResult([{ id: "c1" }]); // owned
    const res = await request(app())
      .post("/chat/conversations/c1/attachments")
      .attach("file", Buffer.from("hello"), {
        filename: "notes.txt",
        contentType: "text/plain",
      });
    expect(res.status).toBe(400);
  });

  it("accepts a PDF and returns 202 with a chunk count", async () => {
    dbMock.setResult([{ id: "att1" }]); // ownership + insert returning
    const res = await request(app())
      .post("/chat/conversations/c1/attachments")
      .attach("file", Buffer.from("%PDF-1.4 fake"), {
        filename: "doc.pdf",
        contentType: "application/pdf",
      });
    expect(res.status).toBe(202);
    expect(res.body.attachmentId).toBe("att1");
    expect(res.body.status).toBe("ready");
    expect(res.body.chunkCount).toBe(3);
  });

  it("does not persist an attachment when ingestion throws and returns 200 with status:failed", async () => {
    dbMock.setResult([{ id: "att1" }]); // ownership lookup
    vi.mocked(ingestFile).mockRejectedValueOnce(new Error("ingest down"));
    const insertSpy = dbMock.db.insert as ReturnType<typeof vi.fn>;
    const res = await request(app())
      .post("/chat/conversations/c1/attachments")
      .attach("file", Buffer.from("%PDF-1.4 fake"), {
        filename: "doc.pdf",
        contentType: "application/pdf",
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ attachmentId: "", status: "failed", chunkCount: 0 });
    // No attachment row was written for the failed ingest.
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("does not persist an attachment when ingestion returns a non-ok status and returns 200 with status:failed", async () => {
    dbMock.setResult([{ id: "att1" }]); // ownership lookup
    vi.mocked(ingestFile).mockResolvedValueOnce({ status: "error", chunkCount: 0 });
    const insertSpy = dbMock.db.insert as ReturnType<typeof vi.fn>;
    const res = await request(app())
      .post("/chat/conversations/c1/attachments")
      .attach("file", Buffer.from("%PDF-1.4 fake"), {
        filename: "doc.pdf",
        contentType: "application/pdf",
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ attachmentId: "", status: "failed", chunkCount: 0 });
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("returns 413 for an oversize upload", async () => {
    dbMock.setResult([{ id: "att1" }]); // owned
    const res = await request(app())
      .post("/chat/conversations/c1/attachments")
      .attach("file", Buffer.alloc(51 * 1024 * 1024), {
        filename: "big.pdf",
        contentType: "application/pdf",
      });
    expect(res.status).toBe(413);
  });
});
