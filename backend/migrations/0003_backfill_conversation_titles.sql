-- One-time backfill: give still-default conversations a title from their first
-- user message (truncated to 80 chars, matching the live titling in the message
-- route). Only touches conversations still named 'New chat', so it is safe to
-- re-run and never overwrites a real title.
UPDATE "conversations" AS c
SET "title" = LEFT(m."content", 80)
FROM (
	SELECT DISTINCT ON ("conversation_id") "conversation_id", "content"
	FROM "messages"
	WHERE "role" = 'user'
	ORDER BY "conversation_id", "created_at" ASC
) AS m
WHERE c."id" = m."conversation_id" AND c."title" = 'New chat';
