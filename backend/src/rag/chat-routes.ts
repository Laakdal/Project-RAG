import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import multer from "multer";
import { db } from "../db/index.js";
import { conversations, messages, attachments } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";
import { requireCsrf } from "../auth/csrf.js";
import { queryRag, ingestFile } from "./n8n-client.js";

const router = Router();
router.use(requireAuth);

// 25 MB cap; keep the file in memory so we can forward it to n8n.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

// Wrap multer so an oversize upload returns a clean 413 instead of falling
// through to the global error handler (which would surface a 500).
function uploadSingle(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "File too large (max 25 MB)" });
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
        createdAt: attachments.createdAt,
      })
      .from(attachments)
      .where(eq(attachments.conversationId, req.params.id))
      .orderBy(attachments.createdAt);
    res.json(rows);
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

    // Query first; persist the turn only after a successful answer so a
    // failure leaves no orphaned message.
    let result;
    try {
      result = await queryRag(req.params.id, question);
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
    // is still the default, so later messages don't overwrite it).
    await db
      .update(conversations)
      .set({ title: question.slice(0, 80) })
      .where(
        and(
          eq(conversations.id, req.params.id),
          eq(conversations.title, "New chat"),
        ),
      );

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
    if (!file || !ALLOWED_MIME.has(file.mimetype)) {
      res.status(400).json({ error: "Only PDF and DOCX files are supported" });
      return;
    }

    let result;
    try {
      result = await ingestFile(
        req.params.id,
        file.originalname,
        file.buffer,
        file.mimetype,
      );
    } catch {
      // Record the failed ingest so the conversation reflects the attempt.
      await db.insert(attachments).values({
        conversationId: req.params.id,
        filename: file.originalname,
        status: "failed",
      });
      res.status(502).json({ error: "Indexing is unavailable right now" });
      return;
    }

    const rows = await db
      .insert(attachments)
      .values({
        conversationId: req.params.id,
        filename: file.originalname,
        status: "ready",
        chunkCount: result.chunkCount,
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
