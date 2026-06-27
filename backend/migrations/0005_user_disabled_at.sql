-- Adds the nullable disabled_at flag to users. drizzle-kit also emitted ALTERs
-- for attachments.mime_type/data here; those were removed because migration 0004
-- already added those columns to the live DB (0004 was hand-written and never
-- updated the meta snapshot, so generate saw them as new). Re-adding them would
-- abort db:migrate on "column already exists".
ALTER TABLE "users" ADD COLUMN "disabled_at" timestamp with time zone;