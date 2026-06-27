ALTER TABLE "attachments" ADD COLUMN "mime_type" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "data" "bytea";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disabled_at" timestamp with time zone;