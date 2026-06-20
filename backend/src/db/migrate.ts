import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index.js";

async function main() {
  // eslint-disable-next-line no-console
  console.log("Running pending migrations...");
  await migrate(db, { migrationsFolder: "./migrations" });
  // eslint-disable-next-line no-console
  console.log("Migrations complete.");
  await pool.end();
}

main().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error("Migration failed:", error);
  await pool.end();
  process.exit(1);
});
