import { hasBearerToken, readEnvironmentSecret } from "../auth";
import {
  postgres,
  PostgresStatusDatabase,
  type DrizzlePostgresClient,
  type PostgresClient,
  type PostgresDatabaseClient,
  type PostgresStatusDatabaseOptions,
} from "../db/postgres";
import type { StatusPage } from "../types";

export { postgres, PostgresStatusDatabase };
export type {
  DrizzlePostgresClient,
  PostgresClient,
  PostgresDatabaseClient,
  PostgresStatusDatabaseOptions,
};

export type VercelCronTask = "checks" | "summarize" | "cleanup";

/** Executes one Vercel Cron task with a stable JSON response for route handlers. */
export async function runVercelCron(
  statusPage: StatusPage,
  task: VercelCronTask,
  now = new Date(),
): Promise<Response> {
  switch (task) {
    case "checks": {
      const results = await statusPage.cron.runChecks(now);
      return Response.json({ ok: true, task, results: results.length });
    }
    case "summarize": {
      const result = await statusPage.cron.summarize(now);
      return Response.json({ ok: true, task, result });
    }
    case "cleanup":
      await statusPage.cron.cleanup(now);
      return Response.json({ ok: true, task });
  }
}

/**
 * App Router compatible wrapper for Vercel Cron routes.
 *
 * The secret comes from `options.secret` or `CRON_SECRET`. Without one the
 * route refuses every request rather than staying open: `cleanup` deletes
 * history and `checks` sends outbound requests to every configured monitor,
 * so an unauthenticated trigger is both destructive and abusable.
 */
export function vercelCronHandler(
  statusPage: StatusPage,
  task: VercelCronTask,
  options: { secret?: string } = {},
): (request: Request) => Promise<Response> {
  return async (request) => {
    const secret =
      options.secret?.trim() || readEnvironmentSecret("CRON_SECRET");
    if (!secret) {
      return Response.json(
        {
          error:
            "Cron routes are disabled. Set CRON_SECRET, or pass a secret to vercelCronHandler.",
        },
        { status: 503 },
      );
    }
    if (!hasBearerToken(request.headers.get("authorization"), secret)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return runVercelCron(statusPage, task);
  };
}
