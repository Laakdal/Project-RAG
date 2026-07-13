import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { libraryDocuments } from "../db/schema.js";
import type { LibraryDocument, NewLibraryDocument } from "../db/schema.js";

export async function insertDocument(row: NewLibraryDocument): Promise<string> {
  const inserted = await db
    .insert(libraryDocuments)
    .values(row)
    .returning({ id: libraryDocuments.id });
  return inserted[0].id;
}

export async function updateDocument(
  id: string,
  patch: Partial<NewLibraryDocument>,
): Promise<void> {
  await db.update(libraryDocuments).set(patch).where(eq(libraryDocuments.id, id));
}

export async function listIndexed(): Promise<LibraryDocument[]> {
  return db.select().from(libraryDocuments);
}

export async function deleteDocument(id: string): Promise<void> {
  await db.delete(libraryDocuments).where(eq(libraryDocuments.id, id));
}

// True only when a source is already successfully indexed. Rows left in
// "indexing"/"failed" state (e.g. an embedding call that errored) must NOT count
// as present, otherwise a retry would skip them and they would never get vectors.
export async function existsBySourceRef(sourceRef: string): Promise<boolean> {
  const rows = await db
    .select({ id: libraryDocuments.id })
    .from(libraryDocuments)
    .where(and(eq(libraryDocuments.sourceRef, sourceRef), eq(libraryDocuments.status, "indexed")))
    .limit(1);
  return rows.length > 0;
}

// All Drive file ids already successfully indexed. The bulk backfill fetches
// these once so it can skip re-reading (OCR) documents already in the library.
// Only "indexed" rows count — a failed row should be retried, not skipped.
export async function listIndexedDriveRefs(): Promise<string[]> {
  const rows = await db
    .select({ sourceRef: libraryDocuments.sourceRef })
    .from(libraryDocuments)
    .where(and(eq(libraryDocuments.source, "drive"), eq(libraryDocuments.status, "indexed")));
  return rows.map((r) => r.sourceRef).filter((r): r is string => !!r);
}

export async function summary(): Promise<{
  total: number;
  failed: number;
  lastIndexedAt: string | null;
}> {
  const rows = await db
    .select({
      total: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where ${libraryDocuments.status} = 'failed')::int`,
      lastIndexedAt: sql<string | null>`max(${libraryDocuments.indexedAt})`,
    })
    .from(libraryDocuments);
  return rows[0];
}
