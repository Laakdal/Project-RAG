DROP TABLE "library_documents";
--> statement-breakpoint
CREATE TABLE "library_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"last_error" text,
	"modified_time" text,
	"web_url" text,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL
);
