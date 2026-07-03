import { eq, sql } from "drizzle-orm";
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
