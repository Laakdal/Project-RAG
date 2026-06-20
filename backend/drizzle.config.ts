import { defineConfig } from "drizzle-kit";
import { config as loadEnv } from "dotenv";

loadEnv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for drizzle-kit");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url: databaseUrl,
  },
});
