import "./proxy-bootstrap.js";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import cookieParser from "cookie-parser";
import cors from "cors";
import { sql } from "drizzle-orm";
import { config, isProduction } from "./config.js";
import { db, pool } from "./db/index.js";
import authRoutes from "./auth/routes.js";
import { chatRouter } from "./rag/chat-routes.js";
import { adminRouter } from "./admin/routes.js";
import { libraryRouter } from "./library/routes.js";
import { libraryBackfillRouter } from "./library/backfill-routes.js";
import { CSRF_HEADER_NAME } from "./auth/csrf.js";
import { initSettings } from "./settings/service.js";

const app = express();

// Trust the first proxy hop so secure cookies work behind a reverse proxy.
app.set("trust proxy", 1);

app.use(
  cors({
    origin: config.CORS_ORIGIN,
    credentials: true,
    // Allow the SPA to send the CSRF token header on cross-origin requests.
    allowedHeaders: ["Content-Type", CSRF_HEADER_NAME],
  }),
);

app.use(express.json());
app.use(cookieParser());

const PgSession = connectPgSimple(session);

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "user_sessions",
      // The session table is provisioned via an explicit migration so the app
      // role does not need DDL privileges at runtime.
      createTableIfMissing: false,
    }),
    name: "connect.sid",
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: config.COOKIE_SECURE,
      sameSite: config.COOKIE_SAMESITE,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  }),
);

app.get("/health", async (_req: Request, res: Response) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "unavailable" });
  }
});

app.use("/auth", authRoutes);
app.use("/chat", chatRouter);
app.use("/admin", adminRouter);
// Token-authed backfill endpoints must be matched before the session-guarded
// library router so n8n can reach them without an admin session.
app.use("/library", libraryBackfillRouter);
app.use("/library", libraryRouter);

// 404 handler.
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// Centralized error handler. Never leak stack traces in production.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (!isProduction) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
  const message = isProduction
    ? "Internal server error"
    : err instanceof Error
      ? err.message
      : "Internal server error";
  res.status(500).json({ error: message });
});

// Load admin-editable settings (creates the table if needed). Best-effort: a
// failure just means callers fall back to the env config.
try {
  await initSettings();
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn("Settings init failed; using env config only:", err instanceof Error ? err.message : err);
}

const server = app.listen(config.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on port ${config.PORT}`);
});

function shutdown(signal: string) {
  // eslint-disable-next-line no-console
  console.log(`Received ${signal}, shutting down...`);
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export { app };
