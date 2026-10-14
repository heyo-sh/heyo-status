import { runStatusChecks } from "./checks";
import { createStatusSnapshotCache } from "./cache";
import { reconcileAutomaticIncidents } from "./incidents";
import {
  collectMonitorNotificationEvents,
  dispatchNotifications,
} from "./notification-dispatcher";
import { createStatusApp } from "./api";
import type {
  StatusPage,
  StatusPageApi,
  StatusPageConfig,
  StatusPageCron,
} from "./types";

/** Attaches the stage-3 HTTP, API, and scheduler surfaces to a config. */
export function createStatusPage(config: StatusPageConfig): StatusPage {
  // One cache is shared by the HTTP routes and the programmatic API so a page
  // render and its API calls cannot disagree about the current snapshot.
  const snapshots = createStatusSnapshotCache(config);
  // The router is created before `cron`, so manual runs are forwarded lazily.
  const app = createStatusApp(config, {
    snapshots,
    runChecks: (now) => cron.runChecks(now),
  });
  const api: StatusPageApi = {
    async getSnapshot(now) {
      return snapshots.get(now);
    },
    async listMonitors(now) {
      return (await snapshots.get(now)).monitors;
    },
    async getMonitor(name, now) {
      return (
        (await snapshots.get(now)).monitors.find(
          (monitor) => monitor.name === name,
        ) ?? null
      );
    },
    invalidate() {
      snapshots.invalidate();
    },
  };
  const cron: StatusPageCron = {
    async runChecks(now = new Date()) {
      const results = await runStatusChecks(config.monitors, now);
      // Evaluate transitions against history before this batch is persisted.
      const monitorEvents = await collectMonitorNotificationEvents(
        config,
        results,
        now,
      );
      await config.database.insertCheckResults(results);
      const incidentEvents = await reconcileAutomaticIncidents(
        config,
        results,
        now,
      );
      snapshots.invalidate();
      await dispatchNotifications(config, [
        ...monitorEvents,
        ...incidentEvents,
      ]);
      return results;
    },
    async summarize(now = new Date()) {
      const result = await config.database.summarizeHistory(now);
      snapshots.invalidate();
      return result;
    },
    async cleanup(now = new Date()) {
      await config.database.cleanup(config.checks.retentionDays, now);
      snapshots.invalidate();
    },
  };

  // Keeping runtime fields non-enumerable retains the clean, serialisable
  // configuration object users received in stages 1–2.
  return Object.defineProperties(config, {
    handler: {
      // Hono answers unmatched routes synchronously; the public contract is
      // always a promise, so adapters can rely on `.then`/`Promise.all`.
      value: async (request: Request): Promise<Response> =>
        app.fetch(stripBasePath(config, request)),
      enumerable: false,
    },
    api: { value: api, enumerable: false },
    cron: { value: cron, enumerable: false },
  }) as StatusPage;
}

/**
 * Removes the mount prefix so one catch-all route can serve every endpoint,
 * exactly like the framework adapters document. Requests which already use a
 * router-relative path (the CLI dev server, direct `handler` calls in tests)
 * are passed through unchanged.
 */
function stripBasePath(config: StatusPageConfig, request: Request): Request {
  const url = new URL(request.url);
  const { basePath } = config;
  if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) {
    return request;
  }

  url.pathname = url.pathname.slice(basePath.length) || "/";
  // `Request` keeps method, headers and body; only the URL changes.
  return new Request(url, request);
}
