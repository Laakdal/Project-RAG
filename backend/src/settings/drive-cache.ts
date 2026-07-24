import { sql, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { driveReadCache } from "../db/schema.js";

// Read-through cache for on-demand Drive lookups (see the Drive lookup node).
// Unlike the settings/connections caches this holds no secret and can be large
// (up to 100k chars per file across many files), so it is NOT mirrored in
// memory — callers hit the DB directly. Ported from the n8n `drive_read_cache`
// data table.

const MAX_MARKDOWN = 100_000;

export async function initDriveReadCache(): Promise<void> {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS drive_read_cache (
    drive_file_id text PRIMARY KEY,
    modified_time text NOT NULL,
    filename text NOT NULL,
    markdown text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
}

// Cached Markdown for a Drive file, or undefined if never read. The caller
// decides freshness by comparing `modifiedTime` (mirrors the n8n Decide Cache
// node: a hit needs non-empty markdown AND a matching modifiedTime).
export async function getDriveReadCache(
  driveFileId: string,
): Promise<{ markdown: string; modifiedTime: string } | undefined> {
  const [row] = await db
    .select({ markdown: driveReadCache.markdown, modifiedTime: driveReadCache.modifiedTime })
    .from(driveReadCache)
    .where(eq(driveReadCache.driveFileId, driveFileId))
    .limit(1);
  return row;
}

// Upsert on the file id, storing the Markdown truncated to 100k chars (as n8n
// does) so one enormous document can't bloat the table.
export async function upsertDriveReadCache(entry: {
  driveFileId: string;
  modifiedTime: string;
  filename: string;
  markdown: string;
}): Promise<void> {
  const markdown = entry.markdown.slice(0, MAX_MARKDOWN);
  await db
    .insert(driveReadCache)
    .values({
      driveFileId: entry.driveFileId,
      modifiedTime: entry.modifiedTime,
      filename: entry.filename,
      markdown,
    })
    .onConflictDoUpdate({
      target: driveReadCache.driveFileId,
      set: {
        modifiedTime: entry.modifiedTime,
        filename: entry.filename,
        markdown,
        updatedAt: new Date(),
      },
    });
}
