import { Router, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { conversations, messages } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";
import { requireCsrf } from "../auth/csrf.js";

const router = Router();
router.use(requireAuth);

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
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.createdAt));
  res.json(rows);
});

router.get(
  "/conversations/:id/messages",
  async (req: Request, res: Response) => {
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

export { router as chatRouter, ownedConversation };
