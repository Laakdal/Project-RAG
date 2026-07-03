import { Router, type Request, type Response } from "express";
import { requireAuth, requireAdmin } from "../auth/middleware.js";
import { summary } from "./repo.js";

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

// Report library index state (counts + last index time) for the admin UI.
router.get("/status", async (_req: Request, res: Response) => {
  res.json(await summary());
});

export { router as libraryRouter };
