import { lazyStatusDatabase } from "@heyo-sh/heyo-status/db/lazy";
import { postgres } from "@heyo-sh/heyo-status/deployments/vercel";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Configure your database here. Replace this example with a private connection
 * string before deployment; do not commit production credentials to git.
 * The pool remains lazy so builds do not need a live database connection.
 */
const connectionString =
  "postgres://postgres:postgres@localhost:5432/{{PROJECT_NAME}}";

export const database = lazyStatusDatabase(() =>
  postgres(drizzle(new Pool({ connectionString }))),
);
