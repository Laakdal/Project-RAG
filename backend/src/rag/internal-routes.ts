import { Router, type Request, type Response, type NextFunction } from "express";
import { config } from "../config.js";
import { publishProgress } from "./progress-bus.js";

// Internal server-to-server endpoints (n8n -> backend). Not session-guarded;
// authenticated with the shared LIBRARY_INDEX_TOKEN via the x-index-token header
// (same scheme as the Drive backfill), and reachable only on the private Docker
// network. Mounted at /internal in server.ts BEFORE any session middleware need.
const router = Router();

const INDEX_TOKEN_HEADER = "x-index-token";

function requireIndexToken(req: Request, res: Response, next: NextFunction): void {
  const expected = config.LIBRARY_INDEX_TOKEN;
  if (!expected) {
    res.status(503).json({ error: "Internal endpoint disabled (LIBRARY_INDEX_TOKEN unset)" });
    return;
  }
  const got = req.get(INDEX_TOKEN_HEADER);
  if (!got || got !== expected) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  next();
}

router.use(requireIndexToken);

// n8n posts one of these as it reaches each pipeline stage. Best-effort: the
// workflow fires these fire-and-forget, so a slow/failed post never blocks the
// real answer. We publish to the in-memory bus; if no SSE client is listening
// for this jobId (e.g. it already finished), the publish is a harmless no-op.
router.post("/progress", (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    jobId?: unknown;
    status?: unknown;
    message?: unknown;
  };
  const jobId = typeof body.jobId === "string" ? body.jobId : "";
  const message = typeof body.message === "string" ? body.message : "";
  if (!jobId || !message) {
    res.status(400).json({ error: "jobId and message are required" });
    return;
  }
  const status = typeof body.status === "string" ? body.status : "processing";
  publishProgress(jobId, { status, message });
  res.status(204).end();
});

export { router as internalRouter };
