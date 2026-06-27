import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, type User } from "../db/schema.js";

// Augment the Express request with an optional resolved user.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: Omit<User, "passwordHash">;
    }
  }
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.session.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

/**
 * Guard for admin-only routes. Loads the session user's admin flag and rejects
 * non-admins with 403. Place after requireAuth (or rely on its own 401 when no
 * session is present).
 */
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.session.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const rows = await db
      .select({ isAdmin: users.isAdmin })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!rows[0]?.isAdmin) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Optional middleware: if a session exists, load the user (without the
 * password hash) and attach it to req.user. Never blocks the request.
 */
export async function attachUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.session.userId;
    if (userId) {
      const rows = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          isAdmin: users.isAdmin,
          disabledAt: users.disabledAt,
          createdAt: users.createdAt,
          lastLoginAt: users.lastLoginAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (rows[0]) {
        req.user = rows[0];
      }
    }
    next();
  } catch (error) {
    next(error);
  }
}
