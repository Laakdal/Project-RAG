import { sql, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { driveSources, type DriveSource } from "../db/schema.js";

// In-memory cache for synchronous access from the Drive lookup node.
let cache: DriveSource[] = [];

export async function initDriveSources(): Promise<void> {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS drive_sources (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL, client_id text NOT NULL DEFAULT '', client_secret text NOT NULL DEFAULT '',
    refresh_token text, folder_id text,
    created_at timestamptz NOT NULL DEFAULT now())`);
  // Migrate from the earlier service-account shape to OAuth columns.
  await db.execute(sql`ALTER TABLE drive_sources DROP COLUMN IF EXISTS service_account_json`);
  await db.execute(sql`ALTER TABLE drive_sources ADD COLUMN IF NOT EXISTS client_id text NOT NULL DEFAULT ''`);
  await db.execute(sql`ALTER TABLE drive_sources ADD COLUMN IF NOT EXISTS client_secret text NOT NULL DEFAULT ''`);
  await db.execute(sql`ALTER TABLE drive_sources ADD COLUMN IF NOT EXISTS refresh_token text`);
  await db.execute(sql`ALTER TABLE drive_sources ALTER COLUMN folder_id DROP NOT NULL`);
  await reload();
}

async function reload(): Promise<void> {
  cache = await db.select().from(driveSources).orderBy(driveSources.createdAt);
}

// Synchronous list for the Drive lookup node (searches every connected source).
export function listDriveSources(): DriveSource[] {
  return cache;
}

export function getDriveSource(id: string): DriveSource | undefined {
  return cache.find((s) => s.id === id);
}

export async function createDriveSource(data: {
  name: string;
  clientId: string;
  clientSecret: string;
  folderId?: string;
}): Promise<void> {
  await db.insert(driveSources).values({
    name: data.name,
    clientId: data.clientId,
    clientSecret: data.clientSecret,
    folderId: data.folderId || null,
  });
  await reload();
}

export async function updateDriveSource(
  id: string,
  data: { name: string; clientId: string; folderId?: string; clientSecret?: string },
): Promise<void> {
  // Client secret is write-only: only replace it when a new value is supplied.
  const set: Record<string, string | null> = {
    name: data.name,
    clientId: data.clientId,
    folderId: data.folderId || null,
  };
  if (data.clientSecret) set.clientSecret = data.clientSecret;
  await db.update(driveSources).set(set).where(eq(driveSources.id, id));
  await reload();
}

export async function setRefreshToken(id: string, refreshToken: string): Promise<void> {
  await db.update(driveSources).set({ refreshToken }).where(eq(driveSources.id, id));
  await reload();
}

export async function deleteDriveSource(id: string): Promise<void> {
  await db.delete(driveSources).where(eq(driveSources.id, id));
  await reload();
}

// Safe view for the admin UI: never returns the client secret or refresh token.
export function driveSourcesView() {
  return cache.map((s) => ({
    id: s.id,
    name: s.name,
    folderId: s.folderId ?? "",
    clientId: s.clientId,
    connected: Boolean(s.refreshToken),
  }));
}
