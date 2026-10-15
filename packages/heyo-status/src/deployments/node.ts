import type { StatusPage } from "../types";

export interface NodeCronTask {
  stop(): void;
}

/** Structural type accepted from `node-cron` without adding it to core deps. */
export interface NodeCronScheduler {
  schedule(expression: string, task: () => void | Promise<void>): NodeCronTask;
}

export interface StatusNodeScheduler {
  stop(): void;
}

/**
 * Registers check, summary, and cleanup jobs with node-cron (or a compatible
 * scheduler). Errors are contained so one failed run never kills the process.
 */
export function scheduleStatusPage(
  statusPage: StatusPage,
  scheduler: NodeCronScheduler,
): StatusNodeScheduler {
  const jobs = [
    scheduler.schedule(statusPage.checks.interval, () =>
      ignoreFailure(statusPage.cron.runChecks()),
    ),
    scheduler.schedule(statusPage.checks.summaryCron, () =>
      ignoreFailure(statusPage.cron.summarize()),
    ),
    scheduler.schedule(statusPage.checks.cleanupCron, () =>
      ignoreFailure(statusPage.cron.cleanup()),
    ),
  ];
  return { stop: () => jobs.forEach((job) => job.stop()) };
}

async function ignoreFailure(operation: Promise<unknown>): Promise<void> {
  try {
    await operation;
  } catch {
    // Deployers can wrap cron jobs to report failures to their own observability.
  }
}
