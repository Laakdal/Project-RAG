CREATE TABLE "library_documents" (
	"drive_file_id" text PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"modified_time" text NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"web_url" text,
	"last_error" text,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL
);
