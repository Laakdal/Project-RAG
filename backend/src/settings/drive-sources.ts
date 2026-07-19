import { sql, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { driveSources, type DriveSource } from "../db/schema.js";
import { getSetting } from "./service.js";

// In-memory cache for synchronous access from the Drive lookup node.
let cache: DriveSource[] = [];

export async function initDriveSources(): Promise<void> {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS drive_sources (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL, service_account_json text NOT NULL, folder_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now())`);
  await reload();
  // Migrate a pre-existing single Drive config (env/flat settings) into a first
  // source, so nothing is lost when switching to the multi-account model.
  if (cache.length === 0) {
    const sa = getSetting("GOOGLE_SERVICE_ACCOUNT_JSON");
    const folder = getSetting("DRIVE_FOLDER_ID");
    if (sa && folder) {
      await db.insert(driveSources).values({ name: "Default", serviceAccountJson: sa, folderId: folder });
      await reload();
    }
  }
}

async function reload(): Promise<void> {
  cache = await db.select().from(driveSources).orderBy(driveSources.createdAt);
}

// Synchronous list for the Drive lookup node (searches every source).
export function listDriveSources(): DriveSource[] {
  return cache;
}

export async function createDriveSource(data: {
  name: string;
  serviceAccountJson: string;
  folderId: string;
}): Promise<void> {
  await db.insert(driveSources).values(data);
  await reload();
}

export async function updateDriveSource(
  id: string,
  data: { name: string; folderId: string; serviceAccountJson?: string },
): Promise<void> {
  // The service-account JSON is write-only: only replace it when a new value is
  // supplied, otherwise keep the stored key.
  const set: Record<string, string> = { name: data.name, folderId: data.folderId };
  if (data.serviceAccountJson) set.serviceAccountJson = data.serviceAccountJson;
  await db.update(driveSources).set(set).where(eq(driveSources.id, id));
  await reload();
}

// Safe view for the admin UI: never returns the service-account JSON.
export function driveSourcesView() {
  return cache.map((s) => ({ id: s.id, name: s.name, folderId: s.folderId, hasKey: Boolean(s.serviceAccountJson) }));
}

export async function deleteDriveSource(id: string): Promise<void> {
  await db.delete(driveSources).where(eq(driveSources.id, id));
  await reload();
}
