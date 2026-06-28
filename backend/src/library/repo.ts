import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { libraryDocuments } from "../db/schema.js";
import type { LibraryDocument, NewLibraryDocument } from "../db/schema.js";

export async function listIndexed(): Promise<LibraryDocument[]> {
  return db.select().from(libraryDocuments);
}

export async function upsertDocument(row: NewLibraryDocument): Promise<void> {
  await db
    .insert(libraryDocuments)
    .values(row)
    .onConflictDoUpdate({ target: libraryDocuments.driveFileId, set: row });
}

export async function deleteDocument(driveFileId: string): Promise<void> {
  await db.delete(libraryDocuments).where(eq(libraryDocuments.driveFileId, driveFileId));
}

export async function summary(): Promise<{ total: number; failed: number; lastIndexedAt: string | null }> {
  const rows = await db
    .select({
      total: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where ${libraryDocuments.status} = 'failed')::int`,
      lastIndexedAt: sql<string | null>`max(${libraryDocuments.indexedAt})`,
    })
    .from(libraryDocuments);
  return rows[0];
}
