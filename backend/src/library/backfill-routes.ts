import { Router, type Request, type Response, type NextFunction } from "express";
import { config } from "../config.js";
import { indexDriveSource } from "./drive-index.js";
import { existsBySourceRef, listIndexedDriveRefs } from "./repo.js";

// Internal endpoints used by the n8n "Library Backfill" workflow to bulk-index
// the PalmCo Drive tree. The backend has no Google Drive access, so n8n does the
// enumeration + OCR and posts the extracted text here to be chunked, embedded,
// and upserted (reusing the same pipeline as lazy on-read indexing). These are
// server-to-server calls, so they authenticate with a shared token rather than
// an admin browser session.
const router = Router();

const INDEX_TOKEN_HEADER = "x-index-token";

function requireIndexToken(req: Request, res: Response, next: NextFunction): void {
  const expected = config.LIBRARY_INDEX_TOKEN;
  if (!expected) {
    res.status(503).json({ error: "Backfill endpoint disabled (LIBRARY_INDEX_TOKEN unset)" });
    return;
  }
  const got = req.get(INDEX_TOKEN_HEADER);
  if (!got || got !== expected) {
    res.status(401).json({ error: "Invalid index token" });
    return;
  }
  next();
}

router.use(requireIndexToken);

// Drive file ids already indexed, so the backfill can skip re-reading them.
router.get("/drive-refs", async (_req: Request, res: Response) => {
  res.json({ refs: await listIndexedDriveRefs() });
});

// Index one Drive document from its already-extracted text. Idempotent: a
// driveFileId that is already indexed is skipped.
router.post("/index-drive", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    driveFileId?: unknown;
    filename?: unknown;
    text?: unknown;
  };
  const driveFileId = typeof body.driveFileId === "string" ? body.driveFileId : "";
  const filename = typeof body.filename === "string" ? body.filename : "";
  const text = typeof body.text === "string" ? body.text : "";
  if (!driveFileId || !text.trim()) {
    res.status(400).json({ error: "driveFileId and non-empty text are required" });
    return;
  }
  if (await existsBySourceRef(driveFileId)) {
    res.json({ status: "skipped", driveFileId });
    return;
  }
  await indexDriveSource({ driveFileId, filename, text });
  res.json({ status: "indexed", driveFileId });
});

export { router as libraryBackfillRouter };
