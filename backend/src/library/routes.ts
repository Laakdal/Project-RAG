import { Router, type Request, type Response } from "express";
import { requireAuth, requireAdmin } from "../auth/middleware.js";
import { requireCsrf } from "../auth/csrf.js";
import { runSync } from "./sync.js";
import { summary } from "./repo.js";

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

// Trigger an incremental sync of the Drive library into Qdrant. Admin-only.
router.post("/sync", requireCsrf, async (_req: Request, res: Response) => {
  const result = await runSync();
  res.json(result);
});

// Report library index state (counts + last sync time) for the admin UI.
router.get("/status", async (_req: Request, res: Response) => {
  res.json(await summary());
});

export { router as libraryRouter };
