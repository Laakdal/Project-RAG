import { and, eq, sql } from "drizzle-orm";
import { db } from "../../src/db/index.js";
import { attachments } from "../../src/db/schema.js";
import { logNodeError } from "./log.js";

// Does this conversation have at least one successfully ingested upload?
//
// The intent classifier was ported from n8n, where a per-chat upload's text was
// passed INLINE into the answer request — so "gambar apa ini" correctly routed
// to neither Drive nor web, the file already being in context. Here uploads live
// in Qdrant and are only loaded by the `retrieve` node, so that same routing
// answers "I can't see any image". Rather than rely on the classifier guessing,
// the graph checks this fact directly and retrieves whenever the conversation
// actually has something to retrieve.
//
// Best-effort: on any failure, report false and let intent's routing stand —
// degrading to the old behaviour beats failing the whole query.
export async function conversationHasAttachments(conversationId: string): Promise<boolean> {
  try {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(attachments)
      .where(
        and(
          eq(attachments.conversationId, conversationId),
          sql`${attachments.status} <> 'failed'`,
        ),
      );
    return (rows[0]?.n ?? 0) > 0;
  } catch (error) {
    logNodeError("attachments lookup", error);
    return false;
  }
}
