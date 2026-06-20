import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config } from "../config.js";
import * as schema from "./schema.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
});

export const db = drizzle(pool, { schema });

export { schema };
