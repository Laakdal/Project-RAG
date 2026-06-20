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
