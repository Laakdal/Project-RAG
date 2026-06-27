import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, conversations, messages, attachments } from "../db/schema.js";
import { requireAuth, requireAdmin } from "../auth/middleware.js";
import { hashPassword } from "../auth/password.js";
import { passwordSchema } from "../auth/password-policy.js";
import { requireCsrf } from "../auth/csrf.js";

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

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).optional(),
  password: passwordSchema,
  isAdmin: z.boolean().optional().default(false),
});

router.post("/users", requireCsrf, async (req: Request, res: Response) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
    return;
  }
  const { email, name, password, isAdmin } = parsed.data;
  const passwordHash = await hashPassword(password);

  try {
    const rows = await db
      .insert(users)
      .values({
        email: email.toLowerCase(),
        passwordHash,
        name: name ?? null,
        isAdmin,
      })
      .returning(userColumns);
    res.status(201).json(rows[0]);
  } catch (err) {
    // 23505 = unique_violation on the email column.
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      res.status(409).json({ error: "A user with that email already exists" });
      return;
    }
    throw err;
  }
});

export { router as adminRouter };
