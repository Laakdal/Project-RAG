import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { hashPassword, verifyPassword } from "./password.js";
import { config } from "../config.js";
import { issueCsrfToken, requireCsrf } from "./csrf.js";
import { attachUser, requireAuth } from "./middleware.js";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// A precomputed argon2 hash of a throwaway password. We verify against this
// when the user does not exist so that response timing does not reveal whether
// an email is registered. Computed once at module load so the no-user branch
// never pays a one-time hash() cost on the first miss after startup.
const dummyHash = await hashPassword("timing-safe-dummy-password");

// Throttle login attempts to mitigate credential stuffing / brute force and the
// CPU/memory-exhaustion DoS of forcing an argon2 verify on every request.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts, please try again later." },
});

// Expose the current CSRF token so the SPA can read it and echo it back in the
// X-CSRF-Token header on state-changing requests.
router.get("/csrf", (req: Request, res: Response) => {
  const token = issueCsrfToken(req, res);
  res.json({ csrfToken: token });
});

router.post("/login", loginLimiter, requireCsrf, async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { email, password } = parsed.data;

  // Select only the columns needed for login and the response. passwordHash is
  // pulled explicitly for verification but is never returned or logged, keeping
  // it out of any accidental full-object serialization.
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isAdmin: users.isAdmin,
      passwordHash: users.passwordHash,
      disabledAt: users.disabledAt,
    })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  const user = rows[0];

  // Always run a verify so timing does not leak whether the user exists.
  const hashToVerify = user ? user.passwordHash : dummyHash;
  const passwordOk = await verifyPassword(hashToVerify, password);

  if (!user || !passwordOk) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  // Block disabled accounts only after the credentials check, so the disabled
  // state is never revealed to someone who doesn't already know the password.
  if (user.disabledAt) {
    res.status(403).json({ error: "This account has been disabled" });
    return;
  }

  // Regenerate the session to prevent session fixation.
  req.session.regenerate((regenErr) => {
    if (regenErr) {
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    req.session.userId = user.id;

    // Best-effort update of last login; do not block the response on it.
    void db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id))
      .catch(() => {
        /* non-fatal */
      });

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      isAdmin: user.isAdmin,
    });
  });
});

router.post("/logout", requireCsrf, (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    // Cookie attributes must match those used when the cookie was set, otherwise
    // some browsers will not clear it. Keep these consistent with the session
    // cookie config in server.ts.
    res.clearCookie("connect.sid", {
      httpOnly: true,
      secure: config.COOKIE_SECURE,
      sameSite: config.COOKIE_SAMESITE,
    });
    res.status(204).end();
  });
});

router.get(
  "/me",
  requireAuth,
  attachUser,
  (req: Request, res: Response) => {
    if (!req.user) {
      // Session points to a deleted user; treat as unauthenticated.
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    res.json(req.user);
  },
);

export default router;
