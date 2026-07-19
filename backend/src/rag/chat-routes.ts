import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import multer from "multer";
import { db } from "../db/index.js";
import { conversations, messages, attachments } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";
import { requireCsrf } from "../auth/csrf.js";
import { queryRag, queryRagStream, ingestFile } from "./provider.js";
import { downloadDriveFile } from "./n8n-client.js";
import type { QueryResult, QuerySource } from "./types.js";
import { searchLibrary, shouldSearchLibrary, librarySufficient } from "../library/retrieve.js";
import { findIndexedDriveByFilename } from "../library/repo.js";
import { titleFromQuestion, summarizeTitle } from "./title-generator.js";
import { isAllowedUpload } from "./upload-allowlist.js";

const router = Router();
router.use(requireAuth);

// 50 MB cap; keep the file in memory so we can forward it to n8n. The whole
// chain must allow at least this much: the nginx vhost body size and n8n's
// N8N_PAYLOAD_SIZE_MAX both need headroom above 50 MB or large uploads fail
// before reaching the ingest workflow.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});


// Types we are willing to render inline (Content-Disposition: inline) in the
// browser. These are non-scripting in the document context — a PDF is shown by
// the sandboxed PDF viewer, images don't execute — so they can't run script on
// our origin. Anything NOT in this set (incl. the client's declared MIME we
// can't trust, DOCX, text/html, image/svg+xml) is served as a neutral download.
const INLINE_SAFE_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
]);

// Wrap multer so an oversize upload returns a clean 413 instead of falling
// through to the global error handler (which would surface a 500).
function uploadSingle(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "File too large (max 50 MB)" });
      return;
    }
    if (err) {
      next(err as Error);
      return;
    }
    next();
  });
}

// Resolve a conversation owned by the session user, or null.
async function ownedConversation(userId: string, conversationId: string) {
  const rows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(eq(conversations.id, conversationId), eq(conversations.userId, userId)),
    )
    .limit(1);
  return rows[0] ?? null;
}

router.post("/conversations", requireCsrf, async (req: Request, res: Response) => {
  const userId = req.session.userId as string;
  const rows = await db
    .insert(conversations)
    .values({ userId })
    .returning({
      id: conversations.id,
      title: conversations.title,
      createdAt: conversations.createdAt,
    });
  res.status(201).json(rows[0]);
});

router.get("/conversations", async (req: Request, res: Response) => {
  const userId = req.session.userId as string;
  const rows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    // Only surface conversations that actually have a message. A brand-new chat
    // with nothing typed (or an upload-only chat the user abandoned) has no
    // message yet and should not clutter the history sidebar.
    .where(
      and(
        eq(conversations.userId, userId),
        sql`exists (select 1 from ${messages} where ${messages.conversationId} = ${conversations.id})`,
      ),
    )
    .orderBy(desc(conversations.createdAt));
  res.json(rows);
});

router.get(
  "/conversations/:id/messages",
  async (req: Request<{ id: string }>, res: Response) => {
    const userId = req.session.userId as string;
    const owned = await ownedConversation(userId, req.params.id);
    if (!owned) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const rows = await db
      .select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        sources: messages.sources,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.conversationId, req.params.id))
      .orderBy(messages.createdAt);
    res.json(rows);
  },
);

router.get(
  "/conversations/:id/attachments",
  async (req: Request<{ id: string }>, res: Response) => {
    const userId = req.session.userId as string;
    const owned = await ownedConversation(userId, req.params.id);
    if (!owned) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const rows = await db
      .select({
        id: attachments.id,
        filename: attachments.filename,
        status: attachments.status,
        chunkCount: attachments.chunkCount,
        // Whether the original file is stored (so the UI knows it can be opened).
        hasFile: sql<boolean>`${attachments.data} is not null`,
        createdAt: attachments.createdAt,
      })
      .from(attachments)
      // Hide failed ingests, including any legacy "failed" rows already in the
      // table from before the upload handler stopped persisting them.
      .where(
        and(
          eq(attachments.conversationId, req.params.id),
          sql`${attachments.status} <> 'failed'`,
        ),
      )
      .orderBy(attachments.createdAt);
    res.json(rows);
  },
);

// Serve the original file inline so the browser can preview it (e.g. open a PDF
// in a new tab). Only files stored on a successful ingest have bytes; older
// rows and failed ingests have none and resolve to 404.
router.get(
  "/conversations/:id/attachments/:attachmentId/file",
  async (
    req: Request<{ id: string; attachmentId: string }>,
    res: Response,
  ) => {
    const userId = req.session.userId as string;
    const owned = await ownedConversation(userId, req.params.id);
    if (!owned) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const rows = await db
      .select({
        data: attachments.data,
        mimeType: attachments.mimeType,
        filename: attachments.filename,
      })
      .from(attachments)
      // Scope to this conversation so an attachment id can't pull a file from
      // another (even owned) conversation.
      .where(
        and(
          eq(attachments.id, req.params.attachmentId),
          eq(attachments.conversationId, req.params.id),
          sql`${attachments.status} <> 'failed'`,
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row || !row.data) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // Sanitize the filename for the header (drop quotes / CR / LF / backslash).
    const safeName = row.filename.replace(/["\\\r\n]/g, "_");

    // SECURITY: never trust the client-declared upload MIME type to render a file
    // inline on this cookie-bearing origin — a spoofed text/html or image/svg+xml
    // would execute script in our origin (stored XSS). Only a small allowlist of
    // script-safe types is served inline; everything else is a neutral download.
    const inline =
      !!row.mimeType && INLINE_SAFE_MIME.has(row.mimeType);

    // Defense in depth: stop content-sniffing (so a mislabeled file can't be
    // re-interpreted as HTML) and sandbox the response (no script / opaque origin).
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox");
    res.setHeader(
      "Content-Type",
      inline ? (row.mimeType as string) : "application/octet-stream",
    );
    res.setHeader(
      "Content-Disposition",
      `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
    );
    res.setHeader("Content-Length", String(row.data.length));
    res.send(row.data);
  },
);

// Preview a shared-library document (a Google Drive file) inline. The backend
// has no Drive access, so it resolves the filename to the indexed Drive id and
// proxies the bytes from the n8n drive-download webhook. Scoped to files that
// are actually in the library, so this can never fetch an arbitrary Drive file.
// Only PDFs are served inline (script-safe); anything else is a neutral download.
router.get("/library-file", async (req: Request, res: Response) => {
  const name = typeof req.query.name === "string" ? req.query.name : "";
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const doc = await findIndexedDriveByFilename(name);
  if (!doc) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  let file: { buffer: Buffer; contentType: string };
  try {
    file = await downloadDriveFile(doc.driveFileId);
  } catch {
    res.status(502).json({ error: "Could not fetch the file" });
    return;
  }
  const isPdf =
    file.contentType.includes("application/pdf") || name.toLowerCase().endsWith(".pdf");
  const safeName = name.replace(/["\\\r\n]/g, "_");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "sandbox");
  res.setHeader("Content-Type", isPdf ? "application/pdf" : "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `${isPdf ? "inline" : "attachment"}; filename="${safeName}"`,
  );
  res.setHeader("Content-Length", String(file.buffer.length));
  res.send(file.buffer);
});

router.delete(
  "/conversations/:id/attachments/:attachmentId",
  requireCsrf,
  async (
    req: Request<{ id: string; attachmentId: string }>,
    res: Response,
  ) => {
    const userId = req.session.userId as string;
    const owned = await ownedConversation(userId, req.params.id);
    if (!owned) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // Scope the delete to this conversation so an attachment id can't be used to
    // remove a row from another (even owned) conversation.
    await db
      .delete(attachments)
      .where(
        and(
          eq(attachments.conversationId, req.params.id),
          eq(attachments.id, req.params.attachmentId),
        ),
      );
    res.status(204).end();
  },
);

const renameSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

router.patch(
  "/conversations/:id",
  requireCsrf,
  async (req: Request<{ id: string }>, res: Response) => {
    const userId = req.session.userId as string;
    const owned = await ownedConversation(userId, req.params.id);
    if (!owned) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const parsed = renameSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "A non-empty title is required" });
      return;
    }
    await db
      .update(conversations)
      .set({ title: parsed.data.title })
      .where(eq(conversations.id, req.params.id));
    res.status(204).end();
  },
);

router.delete(
  "/conversations/:id",
  requireCsrf,
  async (req: Request<{ id: string }>, res: Response) => {
    const userId = req.session.userId as string;
    const owned = await ownedConversation(userId, req.params.id);
    if (!owned) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // messages + attachments cascade via their FK onDelete: cascade.
    await db.delete(conversations).where(eq(conversations.id, req.params.id));
    res.status(204).end();
  },
);

const askSchema = z.object({
  question: z.string().trim().min(1).max(4000),
  useLibrary: z.boolean().optional(),
});

router.post(
  "/conversations/:id/messages",
  requireCsrf,
  async (req: Request<{ id: string }>, res: Response) => {
    const userId = req.session.userId as string;
    const owned = await ownedConversation(userId, req.params.id);
    if (!owned) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const parsed = askSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "A non-empty question is required" });
      return;
    }
    const { question, useLibrary } = parsed.data;

    // Recent turns for multi-turn memory, oldest→newest. The current question
    // isn't persisted yet, so this is purely the PRIOR conversation. Capped so
    // the prompt stays bounded.
    const priorRows = await db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(eq(messages.conversationId, req.params.id))
      .orderBy(desc(messages.createdAt))
      .limit(10);
    const history = priorRows.reverse();

    // The first message titles the conversation. Ask the workflow to summarize
    // a title only on that first turn (no prior history yet).
    const isFirstMessage = history.length === 0;

    // Gate: an explicit useLibrary flag wins; otherwise a cheap intent check
    // decides. Library retrieval must never break a normal answer, so any
    // failure degrades to no library results.
    let libraryDocs: QuerySource[] = [];
    let skipDrive = false;
    try {
      const doSearch = useLibrary ?? (await shouldSearchLibrary(question));
      if (doSearch) {
        libraryDocs = await searchLibrary(question);
        // Skip the slow live Drive read only when the library provably answers
        // the question; on any doubt, fall through to the live read.
        skipDrive = await librarySufficient(question, libraryDocs);
      }
    } catch {
      libraryDocs = [];
      skipDrive = false;
    }

    // Query first; persist the turn only after a successful answer so a
    // failure leaves no orphaned message.
    let result: QueryResult;
    try {
      result = await queryRag(req.params.id, question, history, isFirstMessage, libraryDocs, skipDrive);
    } catch {
      res.status(502).json({ error: "The assistant is unavailable right now" });
      return;
    }

    // Persist the user's message, then the assistant answer with its sources.
    await db.insert(messages).values({
      conversationId: req.params.id,
      role: "user",
      content: question,
    });
    await db.insert(messages).values({
      conversationId: req.params.id,
      role: "assistant",
      content: result.answer,
      sources: result.sources,
    });

    // Title a fresh conversation from its first message (only while the title
    // is still the default, so later messages don't overwrite it). Prefer a
    // title the workflow summarized; otherwise summarize one with the LLM (like
    // ChatGPT/Gemini); fall back to a deterministic heuristic if that's
    // unavailable or fails.
    if (isFirstMessage) {
      const title =
        result.title?.trim() ||
        (await summarizeTitle(question, result.answer)) ||
        titleFromQuestion(question);
      await db
        .update(conversations)
        .set({ title })
        .where(
          and(
            eq(conversations.id, req.params.id),
            eq(conversations.title, "New chat"),
          ),
        );
    }

    res.json({ answer: result.answer, sources: result.sources });
  },
);

// Streaming ask: same as POST /messages, but the answer is delivered over an
// SSE stream so the client can show real pipeline progress ("searching your
// documents", "reading Drive", "writing the answer") instead of a generic
// spinner. Phases are emitted as they start; the turn is persisted after the
// graph finishes and the final answer + sources are sent as a `done` event.
router.post(
  "/conversations/:id/messages/stream",
  requireCsrf,
  async (req: Request<{ id: string }>, res: Response) => {
    const userId = req.session.userId as string;
    const owned = await ownedConversation(userId, req.params.id);
    if (!owned) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const parsed = askSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "A non-empty question is required" });
      return;
    }
    const { question } = parsed.data;

    // Prior turns (oldest→newest), same bounded memory window as the ask route.
    const priorRows = await db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(eq(messages.conversationId, req.params.id))
      .orderBy(desc(messages.createdAt))
      .limit(10);
    const history = priorRows.reverse();
    const isFirstMessage = history.length === 0;

    // Open the SSE stream. `X-Accel-Buffering: no` and `no-transform` keep nginx
    // (and any proxy) from buffering the response, so phases arrive live.
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    let closed = false;
    res.on("close", () => {
      closed = true;
    });
    const send = (event: string, data: unknown) => {
      if (closed || res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    let result: QueryResult;
    try {
      result = await queryRagStream(
        req.params.id,
        question,
        history,
        isFirstMessage,
        (phase) => send("phase", phase),
      );
    } catch {
      send("error", { message: "The assistant is unavailable right now" });
      res.end();
      return;
    }

    // Persist the user message, then the assistant answer with its sources —
    // only after a successful answer, so a failure leaves no orphaned turn.
    await db.insert(messages).values({
      conversationId: req.params.id,
      role: "user",
      content: question,
    });
    await db.insert(messages).values({
      conversationId: req.params.id,
      role: "assistant",
      content: result.answer,
      sources: result.sources,
    });

    // Title a fresh conversation from its first message (same logic as the ask
    // route), only while the title is still the default.
    if (isFirstMessage) {
      const title =
        result.title?.trim() ||
        (await summarizeTitle(question, result.answer)) ||
        titleFromQuestion(question);
      await db
        .update(conversations)
        .set({ title })
        .where(
          and(
            eq(conversations.id, req.params.id),
            eq(conversations.title, "New chat"),
          ),
        );
    }

    send("done", { answer: result.answer, sources: result.sources });
    res.end();
  },
);

// Regenerate the most recent assistant answer IN PLACE: re-run the query for the
// last user question and overwrite the existing assistant message, so the answer
// is replaced rather than a new turn appended. There is no streaming regenerate;
// this mirrors the ask path (queryRag) and updates the row by id so the client
// can refresh that one message.
router.post(
  "/conversations/:id/messages/regenerate",
  requireCsrf,
  async (req: Request<{ id: string }>, res: Response) => {
    const userId = req.session.userId as string;
    const owned = await ownedConversation(userId, req.params.id);
    if (!owned) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // The latest assistant message is the one to replace; the latest user
    // message is the question to re-ask.
    const [lastAssistant] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, req.params.id),
          eq(messages.role, "assistant"),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(1);
    const [lastUser] = await db
      .select({ content: messages.content, createdAt: messages.createdAt })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, req.params.id),
          eq(messages.role, "user"),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(1);
    if (!lastAssistant || !lastUser) {
      res.status(400).json({ error: "Nothing to regenerate" });
      return;
    }

    // Prior turns (everything before the question being regenerated), oldest→
    // newest and capped — same memory window as the ask route.
    const priorRows = await db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, req.params.id),
          lt(messages.createdAt, lastUser.createdAt),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(10);
    const history = priorRows.reverse();

    // Same gated library retrieval as the ask path (regenerate has no explicit
    // useLibrary flag, so it always uses the intent gate). Failure degrades to
    // no library results so a regenerate never breaks on a library outage.
    let libraryDocs: QuerySource[] = [];
    let skipDrive = false;
    try {
      if (await shouldSearchLibrary(lastUser.content)) {
        libraryDocs = await searchLibrary(lastUser.content);
        skipDrive = await librarySufficient(lastUser.content, libraryDocs);
      }
    } catch {
      libraryDocs = [];
      skipDrive = false;
    }

    let result: QueryResult;
    try {
      result = await queryRag(req.params.id, lastUser.content, history, false, libraryDocs, skipDrive);
    } catch {
      res.status(502).json({ error: "The assistant is unavailable right now" });
      return;
    }

    // Overwrite the existing assistant message in place (id stable), so the
    // client replaces that bubble instead of appending a new turn.
    await db
      .update(messages)
      .set({ content: result.answer, sources: result.sources })
      .where(eq(messages.id, lastAssistant.id));

    res.json({ answer: result.answer, sources: result.sources });
  },
);

router.post(
  "/conversations/:id/attachments",
  requireCsrf,
  uploadSingle,
  async (req: Request<{ id: string }>, res: Response) => {
    const userId = req.session.userId as string;
    const owned = await ownedConversation(userId, req.params.id);
    if (!owned) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const file = req.file;
    if (!file || !isAllowedUpload(file.mimetype, file.originalname)) {
      res.status(400).json({ error: "Unsupported file type" });
      return;
    }

    // A failed ingest must leave no persisted attachment: if ingestFile throws
    // (n8n unreachable / non-ok HTTP) or returns a non-ok status, we skip the
    // insert entirely. The endpoint still answers 200 with status:"failed" so
    // the frontend keeps its contract and drops the chip; attachmentId is unused
    // by the client in that case.
    let result;
    try {
      result = await ingestFile(
        req.params.id,
        file.originalname,
        file.buffer,
        file.mimetype,
      );
    } catch {
      res.status(200).json({ attachmentId: "", status: "failed", chunkCount: 0 });
      return;
    }

    if (result.status !== "ok") {
      res.status(200).json({ attachmentId: "", status: "failed", chunkCount: 0 });
      return;
    }

    const rows = await db
      .insert(attachments)
      .values({
        conversationId: req.params.id,
        filename: file.originalname,
        status: "ready",
        chunkCount: result.chunkCount,
        // Keep the original so the file can be opened/previewed later.
        mimeType: file.mimetype,
        data: file.buffer,
      })
      .returning({ id: attachments.id });

    res.status(202).json({
      attachmentId: rows[0].id,
      status: "ready",
      chunkCount: result.chunkCount,
    });
  },
);

export { router as chatRouter };
