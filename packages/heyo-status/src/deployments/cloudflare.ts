import {
  d1,
  D1StatusDatabase,
  type D1Database,
  type D1StatusDatabaseOptions,
} from "../db/d1";
import type { StatusPage } from "../types";

export { d1, D1StatusDatabase };
export type { D1Database, D1StatusDatabaseOptions };

/**
 * Local-only cron entry point for generated Cloudflare framework dev servers.
 * The timer lives in the CLI, but checks execute on the framework server where
 * the request's D1 binding exists. Never expose this in a production build.
 */
export async function runLocalDevCron(
  statusPage: StatusPage,
  request: Request,
  enabled: boolean,
): Promise<Response> {
  if (!enabled) return new Response(null, { status: 404 });
  const url = new URL(request.url);
  if (
    request.method !== "POST" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    request.headers.has("origin")
  ) {
    return new Response(null, { status: 403 });
  }
  const task = request.headers.get("x-heyo-status-dev-cron");
  switch (task) {
    case "checks": {
      const results = await statusPage.cron.runChecks();
      return Response.json({ ok: true, results: results.length });
    }
    case "summarize": {
      const result = await statusPage.cron.summarize();
      return Response.json({ ok: true, result });
    }
    case "cleanup":
      await statusPage.cron.cleanup();
      return Response.json({ ok: true });
    default:
      return new Response(null, { status: 400 });
  }
}

/** Minimal Cloudflare Workers scheduled event shape. */
export interface CloudflareScheduledEvent {
  cron: string;
  scheduledTime?: number;
}

/** Minimal execution context shape, compatible with Workers and unit tests. */
export interface CloudflareExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface CloudflareStatusWorker {
  fetch(request: Request): Promise<Response>;
  scheduled(
    event: CloudflareScheduledEvent,
    env: unknown,
    context: CloudflareExecutionContext,
  ): void;
}

export interface CloudflareCronResult {
  checks: boolean;
  summarized: boolean;
  cleaned: boolean;
}

/** Returns the Worker cron expressions required by a status-page configuration. */
export function cloudflareCronExpressions(statusPage: StatusPage): string[] {
  return [
    ...new Set([
      statusPage.checks.interval,
      statusPage.checks.summaryCron,
      statusPage.checks.cleanupCron,
    ]),
  ];
}

/**
 * Runs only the operation associated with a Cloudflare cron trigger. Passing an
 * unknown trigger is intentionally a no-op, which makes stale Worker cron
 * configuration harmless during deploys.
 */
export async function runCloudflareScheduled(
  statusPage: StatusPage,
  event: CloudflareScheduledEvent,
): Promise<CloudflareCronResult> {
  const now = event.scheduledTime ? new Date(event.scheduledTime) : new Date();
  let checks = false;
  let summarized = false;
  let cleaned = false;

  if (event.cron === statusPage.checks.interval) {
    await statusPage.cron.runChecks(now);
    checks = true;
  }
  if (event.cron === statusPage.checks.summaryCron) {
    await statusPage.cron.summarize(now);
    summarized = true;
  }
  if (event.cron === statusPage.checks.cleanupCron) {
    await statusPage.cron.cleanup(now);
    cleaned = true;
  }

  return { checks, summarized, cleaned };
}

/**
 * Creates a Worker module export. `env` is deliberately left to the caller:
 * configure `d1(env.DB)` while constructing the page, so the core keeps its
 * pure Request → Response contract.
 */
export function cloudflareWorker(
  statusPage: StatusPage,
): CloudflareStatusWorker {
  return {
    fetch: (request) => statusPage.handler(request),
    scheduled: (event, _env, context) => {
      context.waitUntil(runCloudflareScheduled(statusPage, event));
    },
  };
}
