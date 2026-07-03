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
}));

vi.mock("./attachment-reader.js", () => ({
  startBackgroundRead: vi.fn(),
  ensureExtractedText: vi.fn(async () => null),
}));

vi.mock("../library/retrieve.js", () => ({
  searchLibrary: vi.fn(async () => []),
  shouldSearchLibrary: vi.fn(async () => false),
}));

vi.mock("../library/drive-index.js", () => ({
  indexDriveSourcesInBackground: vi.fn(),
}));

// These resolve to the mocked fns above; override per-test with vi.mocked(...).
import { queryRag } from "./n8n-client.js";
import { startBackgroundRead, ensureExtractedText } from "./attachment-reader.js";
import { searchLibrary, shouldSearchLibrary } from "../library/retrieve.js";

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
  dbMock.clearQueue();
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

  it("reports whether each attachment has a stored file", async () => {
    dbMock.setResult([
      {
        id: "att1",
        filename: "doc.pdf",
        status: "ready",
        chunkCount: 3,
        hasFile: true,
        createdAt: "t",
      },
    ]);
    const res = await request(app()).get("/chat/conversations/c1/attachments");
    expect(res.status).toBe(200);
    expect(res.body[0].hasFile).toBe(true);
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

describe("delete attachment route", () => {
  it("deletes an attachment for an owned conversation and returns 204", async () => {
    dbMock.setResult([{ id: "c1" }]); // ownership lookup + delete resolve here
    const deleteSpy = dbMock.db.delete as ReturnType<typeof vi.fn>;
    const whereSpy = dbMock.db.where as ReturnType<typeof vi.fn>;
    const res = await request(app()).delete(
      "/chat/conversations/c1/attachments/att1",
    );
    expect(res.status).toBe(204);

    // The delete targets the attachments table (not conversations), so a stray
    // call here can't drop the whole conversation.
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    const deletedTable = deleteSpy.mock.calls[0][0] as Record<symbol, unknown>;
    const nameSymbol = Object.getOwnPropertySymbols(deletedTable).find(
      (s) => s.toString() === "Symbol(drizzle:Name)",
    );
    expect(nameSymbol && deletedTable[nameSymbol]).toBe("attachments");

    // The delete is scoped by a WHERE clause (conversationId + id), so the row
    // removed is bound to this conversation and attachment id.
    expect(whereSpy).toHaveBeenCalled();
    const lastWhere = whereSpy.mock.calls[whereSpy.mock.calls.length - 1][0];
    expect(lastWhere).toBeDefined();
  });

  it("returns 404 when the conversation is not owned", async () => {
    dbMock.setResult([]); // ownership lookup empty
    const deleteSpy = dbMock.db.delete as ReturnType<typeof vi.fn>;
    const res = await request(app()).delete(
      "/chat/conversations/cX/attachments/att1",
    );
    expect(res.status).toBe(404);
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

    // The query ran with (conversationId, question, history, generateTitle, docs, libraryDocs).
    // The shared db mock returns one truthy row for both the ownership lookup
    // and the history read, so history is non-empty here and generateTitle is
    // false; the first-message path is covered by its own test below.
    // docs is empty because ensureExtractedText returns null by default.
    // libraryDocs is empty because shouldSearchLibrary defaults to false.
    expect(vi.mocked(queryRag)).toHaveBeenCalledWith(
      "c1",
      "What is the answer?",
      expect.any(Array),
      false,
      expect.any(Array),
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

  it("titles the first message via heuristic when n8n returns no title", async () => {
    dbMock.setResult([{ id: "c1" }]); // ownership + inserts + update
    // The first turn has no prior history. The shared mock returns one row for
    // every read, so steer the history query (it ends with .limit(10)) to an
    // empty result while the ownership lookup (.limit(1)) still finds the row.
    const limitSpy = dbMock.db.limit as ReturnType<typeof vi.fn>;
    limitSpy.mockImplementation((n: number) =>
      n === 10
        ? { then: (r: (v: unknown) => unknown) => Promise.resolve([]).then(r) }
        : dbMock.db,
    );
    // n8n returns no title, so the route falls back to titleFromQuestion.
    vi.mocked(queryRag).mockResolvedValueOnce({ answer: "42", sources: [] });

    const res = await request(app())
      .post("/chat/conversations/c1/messages")
      .send({ question: "Apa isi dokumen ini? Tolong jelaskan." });
    expect(res.status).toBe(200);

    // generateTitle is true on the first turn.
    expect(vi.mocked(queryRag)).toHaveBeenCalledWith(
      "c1",
      "Apa isi dokumen ini? Tolong jelaskan.",
      expect.any(Array),
      true,
      expect.any(Array),
      expect.any(Array),
    );

    // The conversation title was set from the heuristic (first sentence).
    const setSpy = dbMock.db.set as ReturnType<typeof vi.fn>;
    expect(setSpy).toHaveBeenCalledWith({ title: "Apa isi dokumen ini" });

    limitSpy.mockImplementation(() => dbMock.db); // restore default chaining
  });

  it("prefers the LLM-summarized title from n8n on the first message", async () => {
    dbMock.setResult([{ id: "c1" }]);
    const limitSpy = dbMock.db.limit as ReturnType<typeof vi.fn>;
    limitSpy.mockImplementation((n: number) =>
      n === 10
        ? { then: (r: (v: unknown) => unknown) => Promise.resolve([]).then(r) }
        : dbMock.db,
    );
    vi.mocked(queryRag).mockResolvedValueOnce({
      answer: "42",
      sources: [],
      title: "Document overview",
    });

    const res = await request(app())
      .post("/chat/conversations/c1/messages")
      .send({ question: "Apa isi dokumen ini?" });
    expect(res.status).toBe(200);

    const setSpy = dbMock.db.set as ReturnType<typeof vi.fn>;
    expect(setSpy).toHaveBeenCalledWith({ title: "Document overview" });

    limitSpy.mockImplementation(() => dbMock.db);
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

  it("passes library docs as the 6th arg when intent gate is true", async () => {
    dbMock.queueResult([{ id: "c1" }]); // ownedConversation
    dbMock.queueResult([]);              // history (no prior messages)
    dbMock.queueResult([]);              // attachments query (no per-chat docs)
    const libDoc = { filename: "lib.pdf", chunkIndex: 0, text: "library content" };
    vi.mocked(shouldSearchLibrary).mockResolvedValueOnce(true);
    vi.mocked(searchLibrary).mockResolvedValueOnce([libDoc]);
    vi.mocked(queryRag).mockResolvedValueOnce({ answer: "A", sources: [] });

    await request(app()).post("/chat/conversations/c1/messages").send({ question: "What is in the SOP?" });

    const libraryDocsArg = vi.mocked(queryRag).mock.calls[0][5];
    expect(libraryDocsArg).toEqual([libDoc]);
  });

  it("asking a question passes the chat's read docs to the query", async () => {
    // Queue results in order: ownership lookup, history query (limit 10 → []),
    // then attachments-for-conv query returns one ready attachment.
    dbMock.queueResult([{ id: "c1" }]); // ownedConversation
    dbMock.queueResult([]);              // history (no prior messages → first turn)
    dbMock.queueResult([{ id: "att1", filename: "a.pdf" }]); // attachments query
    vi.mocked(ensureExtractedText).mockResolvedValueOnce("# the document body");
    vi.mocked(queryRag).mockResolvedValueOnce({ answer: "A", sources: [] });

    await request(app()).post("/chat/conversations/c1/messages").send({ question: "q" });

    const docsArg = vi.mocked(queryRag).mock.calls[0][4];
    expect(docsArg).toEqual([{ filename: "a.pdf", text: "# the document body" }]);
  });
});

describe("regenerate route", () => {
  it("re-runs the query and overwrites the last assistant answer in place", async () => {
    // One row serves the ownership lookup, the last-assistant/last-user reads,
    // and the history read (all reads share the mock's setResult).
    dbMock.setResult([
      { id: "m1", role: "user", content: "redo this", createdAt: "t" },
    ]);
    const setSpy = dbMock.db.set as ReturnType<typeof vi.fn>;
    const res = await request(app())
      .post("/chat/conversations/c1/messages/regenerate")
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.answer).toBe("42");

    // The last user question is re-asked (generateTitle false, empty docs, libraryDocs from intent gate).
    expect(vi.mocked(queryRag)).toHaveBeenCalledWith(
      "c1",
      "redo this",
      expect.any(Array),
      false,
      [],
      expect.any(Array),
    );

    // The answer is written via UPDATE .set (overwrite in place), not a new insert.
    expect(setSpy).toHaveBeenCalledWith({
      content: "42",
      sources: [{ filename: "doc.pdf", chunkIndex: 1, text: "the answer is 42" }],
    });
  });

  it("returns 404 regenerating a conversation the user does not own", async () => {
    dbMock.setResult([]); // ownership lookup empty
    const res = await request(app())
      .post("/chat/conversations/cX/messages/regenerate")
      .send({});
    expect(res.status).toBe(404);
  });

  it("returns 502 when the assistant is unavailable", async () => {
    dbMock.setResult([
      { id: "m1", role: "user", content: "q", createdAt: "t" },
    ]);
    vi.mocked(queryRag).mockRejectedValueOnce(new Error("n8n down"));
    const res = await request(app())
      .post("/chat/conversations/c1/messages/regenerate")
      .send({});
    expect(res.status).toBe(502);
  });
});

describe("attachment route", () => {
  it("rejects a genuinely unsupported file with 400", async () => {
    dbMock.setResult([{ id: "c1" }]); // owned
    const res = await request(app())
      .post("/chat/conversations/c1/attachments")
      .attach("file", Buffer.from("PK fake zip"), {
        filename: "archive.zip",
        contentType: "application/zip",
      });
    expect(res.status).toBe(400);
  });

  it("accepts a newly-supported type (XLSX) and returns 202", async () => {
    dbMock.setResult([{ id: "att1" }]); // owned lookup + insert .returning row
    const res = await request(app())
      .post("/chat/conversations/c1/attachments")
      .attach("file", Buffer.from("PK fake xlsx"), {
        filename: "sheet.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: "processing" });
  });

  it("accepts a .md sent as octet-stream via extension fallback", async () => {
    dbMock.setResult([{ id: "att2" }]);
    const res = await request(app())
      .post("/chat/conversations/c1/attachments")
      .attach("file", Buffer.from("# notes"), {
        filename: "notes.md",
        contentType: "application/octet-stream",
      });
    expect(res.status).toBe(202);
  });

  it("accepts a PDF and returns 202 processing immediately", async () => {
    dbMock.setResult([{ id: "att1" }]); // ownership + insert returning
    const res = await request(app())
      .post("/chat/conversations/c1/attachments")
      .attach("file", Buffer.from("%PDF-1.4 fake"), {
        filename: "doc.pdf",
        contentType: "application/pdf",
      });
    expect(res.status).toBe(202);
    expect(res.body.attachmentId).toBe("att1");
    expect(res.body.status).toBe("processing");
  });

  it("upload returns 202 processing and starts a background read", async () => {
    dbMock.setResult([{ id: "att1" }]); // ownership lookup + insert .returning
    const res = await request(app())
      .post("/chat/conversations/c1/attachments")
      .attach("file", Buffer.from("PK"), { filename: "a.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: "processing" });
    expect(vi.mocked(startBackgroundRead)).toHaveBeenCalledWith("att1");
  });

  it("stores the file bytes and mime type on a successful upload", async () => {
    dbMock.setResult([{ id: "att1" }]); // ownership + insert returning
    const valuesSpy = dbMock.db.values as ReturnType<typeof vi.fn>;
    const res = await request(app())
      .post("/chat/conversations/c1/attachments")
      .attach("file", Buffer.from("%PDF-1.4 fake"), {
        filename: "doc.pdf",
        contentType: "application/pdf",
      });
    expect(res.status).toBe(202);
    const inserted = valuesSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.mimeType).toBe("application/pdf");
    expect(Buffer.isBuffer(inserted.data)).toBe(true);
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

describe("serve attachment file route", () => {
  it("streams the stored file inline for an owned conversation", async () => {
    const pdf = Buffer.from("%PDF-1.4 hello");
    // One result serves the ownership lookup (truthy id-less row is still
    // truthy) and the file select (data/mimeType/filename).
    dbMock.setResult([
      { data: pdf, mimeType: "application/pdf", filename: "doc.pdf" },
    ]);
    const res = await request(app()).get(
      "/chat/conversations/c1/attachments/att1/file",
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toBe(
      'inline; filename="doc.pdf"',
    );
    expect(res.headers["content-length"]).toBe(String(pdf.length));
    // Hardened even on the happy path: no content-sniffing, sandboxed render.
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBe("sandbox");
  });

  it("forces a non-allowlisted mime type to a neutral download (no inline XSS)", async () => {
    // A file whose stored mime is script-capable (e.g. spoofed at upload) must
    // never render inline on our origin — it is served as an octet-stream
    // attachment with nosniff so the browser can't execute it.
    const evil = Buffer.from("<script>alert(document.cookie)</script>");
    dbMock.setResult([
      { data: evil, mimeType: "text/html", filename: "x.html" },
    ]);
    const res = await request(app()).get(
      "/chat/conversations/c1/attachments/att1/file",
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/octet-stream");
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="x.html"',
    );
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBe("sandbox");
  });

  it("returns 404 when the attachment has no stored bytes", async () => {
    dbMock.setResult([{ data: null, mimeType: null, filename: "doc.pdf" }]);
    const res = await request(app()).get(
      "/chat/conversations/c1/attachments/att1/file",
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 serving a file for a conversation the user does not own", async () => {
    dbMock.setResult([]); // ownership lookup empty
    const res = await request(app()).get(
      "/chat/conversations/cX/attachments/att1/file",
    );
    expect(res.status).toBe(404);
  });
});
