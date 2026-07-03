import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { requireAuth, requireAdmin } from "../auth/middleware.js";
import { requireCsrf } from "../auth/csrf.js";
import { isAllowedUpload } from "../rag/upload-allowlist.js";
import { indexUpload } from "./ingest.js";
import { listIndexed, deleteDocument, summary } from "./repo.js";
import { deleteBySource } from "./vector-store.js";

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

function uploadSingle(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "File too large (max 50 MB)" });
      return;
    }
    if (err) {
      next(err as Error);
      return;
    }
    next();
  });
}

// Upload a document into the shared library and index it into Qdrant.
router.post("/documents", requireCsrf, uploadSingle, async (req: Request, res: Response) => {
  const file = req.file;
  if (!file || !isAllowedUpload(file.mimetype, file.originalname)) {
    res.status(400).json({ error: "Unsupported file type" });
    return;
  }
  const result = await indexUpload(file.originalname, file.mimetype, file.buffer);
  res.status(200).json(result);
});

// List indexed library documents (admin UI).
router.get("/documents", async (_req: Request, res: Response) => {
  res.json(await listIndexed());
});

// Remove a document's vectors and its index row.
router.delete("/documents/:id", requireCsrf, async (req: Request<{ id: string }>, res: Response) => {
  await deleteBySource(req.params.id);
  await deleteDocument(req.params.id);
  res.status(204).end();
});

// Report library index state (counts + last index time).
router.get("/status", async (_req: Request, res: Response) => {
  res.json(await summary());
});

export { router as libraryRouter };
