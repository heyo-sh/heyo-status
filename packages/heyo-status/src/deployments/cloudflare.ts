import {
  d1,
  D1StatusDatabase,
  type D1Database,
  type D1StatusDatabaseOptions,
} from "../db/d1";
import type { StatusPage } from "../types";

export { d1, D1StatusDatabase };
export type { D1Database, D1StatusDatabaseOptions };

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
