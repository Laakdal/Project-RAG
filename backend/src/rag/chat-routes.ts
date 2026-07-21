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
import { randomUUID } from "node:crypto";
import { queryRag, downloadDriveFile, type QueryResult, type QuerySource } from "./n8n-client.js";
import { subscribeProgress } from "./progress-bus.js";
import { searchLibrary, shouldSearchLibrary, librarySufficient } from "../library/retrieve.js";
import { findIndexedDriveByFilename } from "../library/repo.js";
import { startBackgroundRead } from "./attachment-reader.js";
import { retrieveAttachmentChunks, deleteAttachmentVectors } from "./attachment-vectors.js";
import { locateChunkPage } from "./pdf-locate.js";
import { config } from "../config.js";
import { titleFromQuestion, summarizeTitle } from "./title-generator.js";
import { isAllowedUpload } from "./upload-allowlist.js";
import { indexDriveSourcesInBackground } from "../library/drive-index.js";

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

// Which page of an attached PDF a cited chunk came from, so clicking its [n]
// badge opens the preview on that page instead of page 1. The chunk text is a
// verbatim slice of the document's pdftotext output, so we re-extract and search
// (see pdf-locate.ts). Answers `{ page: null }` — not an error — when the chunk
// can't be placed (OCR'd page, non-PDF); the client then opens at page 1.
router.get(
  "/conversations/:id/attachments/:attachmentId/locate",
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
    const snippet = typeof req.query.q === "string" ? req.query.q : "";
    if (!snippet.trim()) {
      res.status(400).json({ error: "q is required" });
      return;
    }
    const rows = await db
      .select({ data: attachments.data, mimeType: attachments.mimeType })
      .from(attachments)
      // Scoped to this conversation, like the file route above.
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
    if (row.mimeType !== "application/pdf") {
      res.json({ page: null });
      return;
    }
    try {
      const page = await locateChunkPage(req.params.attachmentId, row.data, snippet);
      res.json({ page });
    } catch (err) {
      // Locating is a convenience; a poppler failure must not break the preview.
      console.error("[chat] failed to locate chunk page", err);
      res.json({ page: null });
    }
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
    // Best-effort: drop the attachment's chunks from the per-chat vector store.
    // Never block or fail the response on this.
    void deleteAttachmentVectors(req.params.attachmentId).catch((err) =>
      console.error("[chat] failed to delete attachment vectors", err),
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
    const { question } = parsed.data;

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

    // Gather per-chat uploaded documents. A large/image-heavy file is read by
    // Gemini in the background (status "processing"); rather than block the
    // request until it finishes (or fail on a slow read), give it a short grace
    // window and then return 202 "reading" so the client can show a progress
    // hint and auto-retry. Reads that finish flip to "ready"/"failed".
    const selectAtt = () =>
      db
        .select({
          id: attachments.id,
          filename: attachments.filename,
          status: attachments.status,
          extractedText: attachments.extractedText,
        })
        .from(attachments)
        .where(eq(attachments.conversationId, req.params.id));
    const isReading = (a: { status: string }) =>
      a.status !== "ready" && a.status !== "failed";

    let attRows = await selectAtt();
    // Brief grace so a fast read answers immediately without a client round-trip.
    if (attRows.some(isReading)) {
      const graceEnd = Date.now() + 7000;
      while (Date.now() < graceEnd && attRows.some(isReading)) {
        await new Promise((r) => setTimeout(r, 1000));
        attRows = await selectAtt();
      }
    }
    // Still reading → let the client retry shortly (auto-retry UX).
    if (attRows.some(isReading)) {
      res.status(202).json({ status: "reading" });
      return;
    }

    const readyDocs = attRows.filter((a) => a.status === "ready" && a.extractedText);

    // Files were attached but none could be read → say so plainly instead of
    // falling through to a generic/web-searched answer that ignores the file.
    if (attRows.length > 0 && readyDocs.length === 0) {
      const answer =
        "Maaf, saya belum berhasil membaca file yang Anda lampirkan. Coba unggah ulang filenya (pastikan gambar atau dokumennya cukup jelas), lalu tanyakan lagi.";
      await db
        .insert(messages)
        .values({ conversationId: req.params.id, role: "user", content: question });
      await db
        .insert(messages)
        .values({ conversationId: req.params.id, role: "assistant", content: answer, sources: [] });
      res.json({ answer, sources: [] });
      return;
    }

    // Per-chat uploaded docs, relevance-gated (like a hosted project assistant):
    // score how relevant the attached file(s) are to THIS question via the
    // per-chat vector store. If relevant, answer from them — whole for a short
    // doc, retrieved chunks for a big book (~4MB would blow the context window).
    // If NOT relevant (the question is about something else, e.g. a Drive file),
    // leave docs empty so the shared library / live Drive search below runs.
    let docs: { filename: string; text: string }[] = [];
    if (readyDocs.length > 0) {
      const totalChars = readyDocs.reduce((n, a) => n + (a.extractedText as string).length, 0);
      let hits: { filename: string; text: string; score: number }[] = [];
      let attRelevant = true; // if we can't score (retrieval error), stay scoped
      try {
        hits = await retrieveAttachmentChunks(req.params.id, question, config.CHAT_RETRIEVE_TOP_K);
        attRelevant = hits.length > 0 && (hits[0].score ?? 0) >= config.CHAT_RELEVANCE_THRESHOLD;
      } catch (err) {
        console.error("[chat] per-chat retrieval failed; scoping to attached docs", err);
      }
      if (attRelevant) {
        if (totalChars <= config.CHAT_WHOLE_DOC_MAX_CHARS) {
          docs = readyDocs.map((a) => ({ filename: a.filename, text: a.extractedText as string }));
        } else {
          docs =
            hits.length > 0
              ? hits.map((h) => ({ filename: h.filename, text: h.text }))
              : readyDocs.map((a) => ({
                  filename: a.filename,
                  text: (a.extractedText as string).slice(0, config.CHAT_WHOLE_DOC_MAX_CHARS),
                }));
        }
      }
      // else: the attached file isn't about this question → docs stays [], and the
      // library/Drive search below answers instead.
    }

    // Search the shared library + live Drive when the chat has no relevant
    // attached docs — i.e. no attachment at all, or an attachment that isn't
    // about this question (relevance gate above left docs empty). When the
    // attachment IS relevant, docs is non-empty and we stay scoped to it.
    let libraryDocs: QuerySource[] = [];
    let skipDrive = false;
    if (docs.length === 0) {
      try {
        if (await shouldSearchLibrary(question)) {
          libraryDocs = await searchLibrary(question);
          // Skip the slow live Drive read only when the library provably answers
          // the question; on any doubt, fall through to the live read.
          skipDrive = await librarySufficient(question, libraryDocs);
        }
      } catch {
        libraryDocs = [];
        skipDrive = false;
      }
    }

    // Query first; persist the turn only after a successful answer so a
    // failure leaves no orphaned message.
    let result;
    try {
      result = await queryRag(req.params.id, question, history, isFirstMessage, docs, libraryDocs, skipDrive);
    } catch {
      res.status(502).json({ error: "The assistant is unavailable right now" });
      return;
    }

    indexDriveSourcesInBackground(result.sources);

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

// Streaming twin of the ask route. Same pipeline (attachment relevance gate →
// shared library / Drive gate → queryRag), but delivered over Server-Sent Events
// so the UI can show REAL per-step progress instead of a timed guess. Backend-
// side steps emit `status` events directly; n8n emits its own (web search,
// writing) by POSTing to /internal/progress, correlated by `jobId` and relayed
// here via the progress bus. The final answer arrives as a `complete` event.
//
// Kept as a separate handler (a deliberate near-duplicate of the JSON route) so
// the proven non-streaming path stays untouched and remains a safe fallback.
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

    // ── SSE setup ──
    const jobId = randomUUID();
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // Stop the reverse proxy (nginx) from buffering the stream — without this the
    // events queue up and arrive all at once with the final answer.
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    let closed = false;
    const send = (event: string, data: unknown): void => {
      if (closed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const status = (message: string, statusKey = "processing"): void =>
      send("status", { status: statusKey, message });

    // Relay n8n's per-stage events (posted to /internal/progress for this jobId).
    const unsubscribe = subscribeProgress(jobId, (ev) => send("status", ev));

    // Keep-alive comments so proxies don't drop the connection while we await the
    // buffered n8n answer (which can take a couple of minutes on a cold Drive read).
    const heartbeat = setInterval(() => {
      if (!closed) res.write(`: ping\n\n`);
    }, 15000);

    const cleanup = (): void => {
      clearInterval(heartbeat);
      unsubscribe();
    };

    // Client navigated away / aborted: stop relaying and drop subscriptions.
    req.on("close", () => {
      closed = true;
      cleanup();
    });

    try {
      send("connected", { jobId });
      status("Understanding your question…", "understanding");

      const priorRows = await db
        .select({ role: messages.role, content: messages.content })
        .from(messages)
        .where(eq(messages.conversationId, req.params.id))
        .orderBy(desc(messages.createdAt))
        .limit(10);
      const history = priorRows.reverse();
      const isFirstMessage = history.length === 0;

      // Attachment reading: unlike the JSON route (7s grace then 202 for the client
      // to retry), stream a "reading…" status and wait inline for the background
      // read to finish, bounded so a stuck read can't hang the request forever.
      const selectAtt = () =>
        db
          .select({
            id: attachments.id,
            filename: attachments.filename,
            status: attachments.status,
            extractedText: attachments.extractedText,
          })
          .from(attachments)
          .where(eq(attachments.conversationId, req.params.id));
      const isReading = (a: { status: string }) =>
        a.status !== "ready" && a.status !== "failed";

      let attRows = await selectAtt();
      if (attRows.some(isReading)) {
        status("Reading your attached file…", "reading");
        const readDeadline = Date.now() + 150_000;
        while (Date.now() < readDeadline && attRows.some(isReading) && !closed) {
          await new Promise((r) => setTimeout(r, 1000));
          attRows = await selectAtt();
        }
      }
      if (closed) {
        cleanup();
        return;
      }
      if (attRows.some(isReading)) {
        send("error", {
          message:
            "File masih diproses dan memakan waktu lebih lama dari biasanya. Silakan coba tanyakan lagi sebentar lagi.",
        });
        cleanup();
        res.end();
        return;
      }

      const readyDocs = attRows.filter((a) => a.status === "ready" && a.extractedText);

      // Files attached but none readable → answer plainly (mirror JSON route).
      if (attRows.length > 0 && readyDocs.length === 0) {
        const answer =
          "Maaf, saya belum berhasil membaca file yang Anda lampirkan. Coba unggah ulang filenya (pastikan gambar atau dokumennya cukup jelas), lalu tanyakan lagi.";
        await db
          .insert(messages)
          .values({ conversationId: req.params.id, role: "user", content: question });
        await db
          .insert(messages)
          .values({ conversationId: req.params.id, role: "assistant", content: answer, sources: [] });
        send("complete", { answer, sources: [] });
        cleanup();
        res.end();
        return;
      }

      // Per-chat relevance gate (mirror JSON route).
      let docs: { filename: string; text: string }[] = [];
      if (readyDocs.length > 0) {
        status("Reading your attached file…", "reading");
        const totalChars = readyDocs.reduce((n, a) => n + (a.extractedText as string).length, 0);
        let hits: { filename: string; text: string; score: number }[] = [];
        let attRelevant = true;
        try {
          hits = await retrieveAttachmentChunks(req.params.id, question, config.CHAT_RETRIEVE_TOP_K);
          attRelevant = hits.length > 0 && (hits[0].score ?? 0) >= config.CHAT_RELEVANCE_THRESHOLD;
        } catch (err) {
          console.error("[chat] per-chat retrieval failed; scoping to attached docs", err);
        }
        if (attRelevant) {
          if (totalChars <= config.CHAT_WHOLE_DOC_MAX_CHARS) {
            docs = readyDocs.map((a) => ({ filename: a.filename, text: a.extractedText as string }));
          } else {
            docs =
              hits.length > 0
                ? hits.map((h) => ({ filename: h.filename, text: h.text }))
                : readyDocs.map((a) => ({
                    filename: a.filename,
                    text: (a.extractedText as string).slice(0, config.CHAT_WHOLE_DOC_MAX_CHARS),
                  }));
          }
        }
      }

      // Shared library + live Drive gate (mirror JSON route).
      let libraryDocs: QuerySource[] = [];
      let skipDrive = false;
      if (docs.length === 0) {
        status("Searching your documents…", "searching_docs");
        try {
          if (await shouldSearchLibrary(question)) {
            libraryDocs = await searchLibrary(question);
            skipDrive = await librarySufficient(question, libraryDocs);
          }
        } catch {
          libraryDocs = [];
          skipDrive = false;
        }
      }

      if (closed) {
        cleanup();
        return;
      }

      // n8n runs the rest (intent, web search, generation) and streams its own
      // progress via jobId → /internal/progress → the bus → the relay above.
      let result: QueryResult;
      try {
        result = await queryRag(
          req.params.id,
          question,
          history,
          isFirstMessage,
          docs,
          libraryDocs,
          skipDrive,
          jobId,
        );
      } catch {
        send("error", { message: "The assistant is unavailable right now" });
        cleanup();
        res.end();
        return;
      }

      if (closed) {
        cleanup();
        return;
      }

      indexDriveSourcesInBackground(result.sources);

      await db
        .insert(messages)
        .values({ conversationId: req.params.id, role: "user", content: question });
      await db.insert(messages).values({
        conversationId: req.params.id,
        role: "assistant",
        content: result.answer,
        sources: result.sources,
      });

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

      send("complete", { answer: result.answer, sources: result.sources });
      cleanup();
      res.end();
    } catch (err) {
      console.error("[chat] stream handler failed", err);
      send("error", { message: "Something went wrong" });
      cleanup();
      try {
        res.end();
      } catch {
        /* already closed */
      }
    }
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
      result = await queryRag(req.params.id, lastUser.content, history, false, [], libraryDocs, skipDrive);
    } catch {
      res.status(502).json({ error: "The assistant is unavailable right now" });
      return;
    }

    indexDriveSourcesInBackground(result.sources);

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

    // Insert immediately with status "processing" (DB default is "indexing",
    // so we must set it explicitly). The file bytes are stored now so the
    // background reader can fetch them without the request still being alive.
    const rows = await db
      .insert(attachments)
      .values({
        conversationId: req.params.id,
        filename: file.originalname,
        status: "processing",
        mimeType: file.mimetype,
        data: file.buffer,
      })
      .returning({ id: attachments.id });

    // Fire-and-forget: the reader fetches the file, extracts text via Gemini,
    // and flips status to "ready" (or "failed") in the background.
    startBackgroundRead(rows[0].id);
    res.status(202).json({ attachmentId: rows[0].id, status: "processing" });
  },
);

export { router as chatRouter };
