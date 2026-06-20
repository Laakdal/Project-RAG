-- Session store table for connect-pg-simple (express-session).
-- Provisioned explicitly here instead of letting the app create it at runtime,
-- so the application DB role needs only DML (no DDL) privileges. The shape
-- matches connect-pg-simple's expected schema; the table name corresponds to
-- the `tableName: "user_sessions"` option in src/server.ts.
CREATE TABLE IF NOT EXISTS "user_sessions" (
	"sid" varchar NOT NULL COLLATE "default",
	"sess" json NOT NULL,
	"expire" timestamp(6) NOT NULL
)
WITH (OIDS=FALSE);
--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_user_sessions_expire" ON "user_sessions" ("expire");
