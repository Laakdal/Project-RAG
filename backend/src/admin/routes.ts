import { Router, type Request, type Response } from "express";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, conversations, messages, attachments } from "../db/schema.js";
import { requireAuth, requireAdmin } from "../auth/middleware.js";

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

// Columns returned for a user row across the admin surface (never the hash).
const userColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  isAdmin: users.isAdmin,
  disabledAt: users.disabledAt,
  createdAt: users.createdAt,
  lastLoginAt: users.lastLoginAt,
};

router.get("/users", async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      ...userColumns,
      conversationCount: sql<number>`(select count(*)::int from ${conversations} where ${conversations.userId} = ${users.id})`,
    })
    .from(users)
    .orderBy(users.createdAt);
  res.json(rows);
});

router.get("/stats", async (_req: Request, res: Response) => {
  const [u] = await db
    .select({
      total: sql<number>`count(*)::int`,
      admins: sql<number>`count(*) filter (where ${users.isAdmin})::int`,
      disabled: sql<number>`count(*) filter (where ${users.disabledAt} is not null)::int`,
    })
    .from(users);
  const [c] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(conversations);
  const [m] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(messages);
  const [a] = await db
    .select({
      total: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where ${attachments.status} = 'failed')::int`,
    })
    .from(attachments);

  res.json({
    users: u.total,
    admins: u.admins,
    disabledUsers: u.disabled,
    conversations: c.total,
    messages: m.total,
    attachments: a.total,
    ingestionFailures: a.failed,
  });
});

export { router as adminRouter };
