import { describe, it, expect, vi } from "vitest";
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

// Imported after mocks are registered.
const { chatRouter } = await import("./chat-routes.js");

function app() {
  return buildTestApp((a) => a.use("/chat", chatRouter));
}

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
});

describe("message route", () => {
  it("rejects an empty question with 400", async () => {
    dbMock.setResult([{ id: "c1" }]); // owned
    const res = await request(app())
      .post("/chat/conversations/c1/messages")
      .send({ question: "" });
    expect(res.status).toBe(400);
  });

  it("answers via n8n and returns answer + sources", async () => {
    dbMock.setResult([{ id: "c1" }]); // ownership + inserts resolve to this
    const res = await request(app())
      .post("/chat/conversations/c1/messages")
      .send({ question: "What is the answer?" });
    expect(res.status).toBe(200);
    expect(res.body.answer).toBe("42");
    expect(res.body.sources[0].filename).toBe("doc.pdf");
  });

  it("returns 404 when the conversation is not owned", async () => {
    dbMock.setResult([]); // ownership lookup empty
    const res = await request(app())
      .post("/chat/conversations/cX/messages")
      .send({ question: "hi" });
    expect(res.status).toBe(404);
  });
});
