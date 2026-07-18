import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, conversations, messages, attachments } from "../db/schema.js";
import { requireAuth, requireAdmin } from "../auth/middleware.js";
import { hashPassword } from "../auth/password.js";
import { passwordSchema } from "../auth/password-policy.js";
import { requireCsrf } from "../auth/csrf.js";
import { GuardError, ensureNotSelf, ensureNotLastAdmin } from "./guards.js";
import { managedView, setSetting, isManagedKey } from "../settings/service.js";

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

// --- Runtime settings (API keys, models, Drive) ---

// List managed settings. Secrets return only whether they are set, never the
// value; non-secrets return the effective value so it can be edited in place.
router.get("/settings", async (_req: Request, res: Response) => {
  res.json({ settings: managedView() });
});

const settingUpdateSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});

// Upsert a single setting. Trims surrounding whitespace (matters for pasted API
// keys); an empty value is allowed only for non-secret fields to clear them.
router.put("/settings", requireCsrf, async (req: Request, res: Response) => {
  const parsed = settingUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
    return;
  }
  const { key } = parsed.data;
  if (!isManagedKey(key)) {
    res.status(400).json({ error: `Unknown setting: ${key}` });
    return;
  }
  await setSetting(key, parsed.data.value.trim());
  res.json({ settings: managedView() });
});

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

// Load a target user plus the current number of active admins in ONE query, so
// the guard checks (self / last-admin) need a single round-trip. Returns null
// when the user does not exist.
async function loadUserWithAdminContext(targetId: string) {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isAdmin: users.isAdmin,
      disabledAt: users.disabledAt,
      activeAdminCount: sql<number>`(select count(*)::int from ${users} ua where ua.is_admin = true and ua.disabled_at is null)`,
    })
    .from(users)
    .where(eq(users.id, targetId))
    .limit(1);
  return rows[0] ?? null;
}

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

const toggleAdminSchema = z.object({ isAdmin: z.boolean() });

router.patch(
  "/users/:id/admin",
  requireCsrf,
  async (req: Request<{ id: string }>, res: Response) => {
    const parsed = toggleAdminSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const targetId = req.params.id;
    const currentUserId = req.session.userId as string;
    const { isAdmin } = parsed.data;

    try {
      // Guards only matter when removing admin rights.
      if (!isAdmin) {
        ensureNotSelf(currentUserId, targetId);
        const target = await loadUserWithAdminContext(targetId);
        if (!target) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        ensureNotLastAdmin(
          target.activeAdminCount,
          target.isAdmin && target.disabledAt === null,
        );
      }

      const rows = await db
        .update(users)
        .set({ isAdmin })
        .where(eq(users.id, targetId))
        .returning({ id: users.id });
      if (!rows[0]) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.status(204).end();
    } catch (err) {
      if (err instanceof GuardError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

const setDisabledSchema = z.object({ disabled: z.boolean() });

router.patch(
  "/users/:id/disabled",
  requireCsrf,
  async (req: Request<{ id: string }>, res: Response) => {
    const parsed = setDisabledSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const targetId = req.params.id;
    const currentUserId = req.session.userId as string;
    const { disabled } = parsed.data;

    try {
      if (disabled) {
        ensureNotSelf(currentUserId, targetId);   // no DB needed — fail fast
      }
      const target = await loadUserWithAdminContext(targetId);
      if (!target) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      if (disabled) {
        ensureNotLastAdmin(
          target.activeAdminCount,
          target.isAdmin && target.disabledAt === null,
        );
      }

      await db
        .update(users)
        .set({ disabledAt: disabled ? new Date() : null })
        .where(eq(users.id, targetId));
      res.status(204).end();
    } catch (err) {
      if (err instanceof GuardError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

const resetPasswordSchema = z.object({ newPassword: passwordSchema });

router.post(
  "/users/:id/password",
  requireCsrf,
  async (req: Request<{ id: string }>, res: Response) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
      return;
    }
    const passwordHash = await hashPassword(parsed.data.newPassword);
    const rows = await db
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, req.params.id))
      .returning({ id: users.id });
    if (!rows[0]) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(204).end();
  },
);

router.delete(
  "/users/:id",
  requireCsrf,
  async (req: Request<{ id: string }>, res: Response) => {
    const targetId = req.params.id;
    const currentUserId = req.session.userId as string;

    try {
      ensureNotSelf(currentUserId, targetId);
      const target = await loadUserWithAdminContext(targetId);
      if (!target) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      ensureNotLastAdmin(
        target.activeAdminCount,
        target.isAdmin && target.disabledAt === null,
      );

      // conversations → messages/attachments cascade via their FK onDelete.
      await db.delete(users).where(eq(users.id, targetId));
      res.status(204).end();
    } catch (err) {
      if (err instanceof GuardError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export { router as adminRouter };
