import { postgres } from "@heyo-sh/heyo-status/deployments/vercel";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await postgres(drizzle(pool)).migrate();
await pool.end();
