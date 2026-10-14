import { lazyStatusDatabase } from "@heyo-sh/heyo-status/db/lazy";
import { postgres } from "@heyo-sh/heyo-status/deployments/vercel";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * The pool is created on the first query rather than on import, so a build
 * step or a CLI invocation without `DATABASE_URL` reports an actionable error
 * instead of failing while the configuration module is being loaded.
 */
export const database = lazyStatusDatabase(() => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required when using the PostgreSQL database overlay.",
    );
  }
  return postgres(drizzle(new Pool({ connectionString })));
});
