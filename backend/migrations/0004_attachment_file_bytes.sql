-- Store the original uploaded file so it can be opened/previewed in the browser.
-- Both columns are nullable: existing rows (and failed ingests, which persist
-- nothing) have no file bytes.
ALTER TABLE "attachments" ADD COLUMN "mime_type" text;
--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "data" bytea;
