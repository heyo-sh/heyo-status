import { dispatchSubscriberNotifications } from "./subscribers";

import type {
  CheckResult,
  Maintenance,
  NotificationDeliveryResult,
  SslCheckResult,
  NotificationLog,
  NotificationMonitor,
  StatusEvent,
  StatusEventType,
  StatusMonitorConfig,
  StatusPageConfig,
} from "./types";

/** A non-throwing record of one configured channel delivery. */
export interface NotificationDispatchResult {
  channelId: string;
  eventType: StatusEventType;
  status: "sent" | "failed";
  attempts: number;
  error: string | null;
}

/**
 * Delivers events to channels subscribed to their type. Individual failures are
 * isolated: a broken webhook must never make monitoring or incident handling
 * fail. Delivery outcomes are persisted when the database adapter supports
 * notification_log.
 */
export async function dispatchNotifications(
  config: StatusPageConfig,
  events: StatusEvent | readonly StatusEvent[],
): Promise<NotificationDispatchResult[]> {
  const items = Array.isArray(events) ? events : [events];
  const deliveries: NotificationDispatchResult[] = [];

  for (const event of items) {
    const enriched = enrichStatusEvent(config, event);
    for (const channel of config.notifications.channels) {
      if (channel.events && !channel.events.includes(enriched.type)) continue;

      try {
        const result = await channel.send(enriched);
        const delivery: NotificationDispatchResult = {
          channelId: channel.id,
          eventType: enriched.type,
          status: "sent",
          attempts: deliveryAttempts(result),
          error: null,
        };
        deliveries.push(delivery);
        await recordDelivery(config, channel.type, enriched, delivery);
      } catch (error) {
        const delivery: NotificationDispatchResult = {
          channelId: channel.id,
          eventType: enriched.type,
          status: "failed",
          attempts: deliveryAttempts(error),
          error: errorMessage(error),
        };
        deliveries.push(delivery);
        await recordDelivery(config, channel.type, enriched, delivery);
      }
    }
    await dispatchSubscriberNotifications(config, enriched);
  }

  return deliveries;
}

/**
 * Determines transition events before a check batch is inserted. This makes a
 * down event fire exactly when the failure threshold is crossed, and a recovery
 * event fire exactly once after a threshold-reaching outage.
 */
export async function collectMonitorNotificationEvents(
  config: StatusPageConfig,
  results: readonly CheckResult[],
  now = new Date(),
): Promise<StatusEvent[]> {
  if (results.length === 0) return [];

  const considered = config.maintenance.enabled
    ? await withoutMaintainedMonitors(config, results, now)
    : results;
  if (considered.length === 0) return [];

  // One read for the whole batch. Reading per monitor made a check run cost a
  // full-history query for every configured monitor, every five minutes.
  const failures = await countConsecutiveFailuresByMonitor(
    config,
    considered.map((result) => result.name),
    now,
  );
  const events: StatusEvent[] = [];

  for (const result of considered) {
    const priorFailures = failures.get(result.name) ?? 0;
    const occurredAt = result.checkedAt;

    if (!result.status) {
      const consecutiveFailures = priorFailures + 1;
      if (consecutiveFailures !== config.notifications.failureThreshold) {
        continue;
      }
      events.push({
        type: isSslExpiry(result) ? "ssl.expiring" : "monitor.down",
        occurredAt,
        monitor: notificationMonitor(config, result, consecutiveFailures),
      });
      continue;
    }

    if (priorFailures >= config.notifications.failureThreshold) {
      events.push({
        type: "monitor.recovered",
        occurredAt,
        monitor: notificationMonitor(config, result, priorFailures),
      });
    }
  }

  return events;
}

async function withoutMaintainedMonitors(
  config: StatusPageConfig,
  results: readonly CheckResult[],
  now: Date,
): Promise<CheckResult[]> {
  const maintenance = await config.database.listUpcoming(now);
  return results.filter(
    (result) => !isCoveredByActiveMaintenance(maintenance, result.name),
  );
}

/**
 * Counts the trailing failures already persisted for each monitor, using a
 * single history read. The batch has not been written yet, so these are the
 * failures that precede it.
 */
export async function countConsecutiveFailuresByMonitor(
  config: StatusPageConfig,
  monitors: readonly string[],
  now = new Date(),
): Promise<Map<string, number>> {
  const names = [...new Set(monitors)];
  const failures = new Map<string, number>();
  if (names.length === 0) return failures;

  const history = await config.database.getSnapshot(
    names,
    config.checks.displayDays,
    now,
  );
  for (const name of names) {
    failures.set(name, countConsecutiveFailures(history.results, name));
  }
  return failures;
}

/** Adds page and monitor configuration detail consistently for every channel. */
export function enrichStatusEvent(
  config: StatusPageConfig,
  event: StatusEvent,
): StatusEvent {
  const monitor = event.monitor
    ? enrichMonitor(config, event.monitor)
    : undefined;
  return {
    ...event,
    ...(monitor ? { monitor } : {}),
    page: event.page ?? {
      title: config.title,
      ...(config.siteUrl ? { siteUrl: config.siteUrl } : {}),
    },
  };
}

function enrichMonitor(
  config: StatusPageConfig,
  monitor: NotificationMonitor,
): NotificationMonitor {
  const definition = config.monitors.find(
    (candidate) => candidate.name === monitor.name,
  );
  if (!definition) return monitor;
  return {
    ...monitor,
    ...((monitor.group ?? definition.group)
      ? { group: monitor.group ?? definition.group }
      : {}),
    ...((monitor.target ?? targetForMonitor(definition))
      ? { target: monitor.target ?? targetForMonitor(definition) }
      : {}),
  };
}

function notificationMonitor(
  config: StatusPageConfig,
  result: CheckResult,
  consecutiveFailures: number,
): NotificationMonitor {
  const monitor = config.monitors.find(
    (candidate) => candidate.name === result.name,
  );
  return {
    ...result,
    consecutiveFailures,
    ...(monitor?.group ? { group: monitor.group } : {}),
    ...(monitor ? { target: targetForMonitor(monitor) } : {}),
  };
}

function targetForMonitor(monitor: StatusMonitorConfig): string {
  switch (monitor.type) {
    case "http":
      return monitor.url;
    case "ssl":
      return `${monitor.host}:${monitor.port ?? 443}`;
    case "tcp":
      return `${monitor.host}:${monitor.port}`;
    case "dns":
      return monitor.host;
    case "composite":
      // Composite monitors have no endpoint of their own; report components.
      return monitor.monitors.join(", ");
  }
}

function countConsecutiveFailures(
  results: readonly CheckResult[],
  name: string,
): number {
  const latestFirst = [...results]
    .filter((result) => result.name === name)
    .sort(
      (left, right) => right.checkedAt.getTime() - left.checkedAt.getTime(),
    );
  let failures = 0;
  for (const result of latestFirst) {
    if (result.status) break;
    failures += 1;
  }
  return failures;
}

function isCoveredByActiveMaintenance(
  maintenance: readonly Maintenance[],
  monitorName: string,
): boolean {
  return maintenance.some(
    (window) =>
      window.status === "in-progress" &&
      (window.affectedMonitors.length === 0 ||
        window.affectedMonitors.includes(monitorName)),
  );
}

/**
 * Reads the flag set by the SSL checker. The certificate state must never be
 * inferred from the human-readable message: rewording a check would silently
 * turn an expiry warning back into a generic outage alert.
 */
function isSslExpiry(result: CheckResult): boolean {
  return result.type === "ssl" && (result as SslCheckResult).expiring === true;
}

async function recordDelivery(
  config: StatusPageConfig,
  channelType: "slack" | "discord" | "webhook" | "email",
  event: StatusEvent,
  delivery: NotificationDispatchResult,
): Promise<void> {
  try {
    await config.database.recordNotification({
      channelId: delivery.channelId,
      channelType,
      eventType: event.type,
      status: delivery.status,
      attempts: delivery.attempts,
      error: delivery.error,
      ...(event.monitor ? { monitorName: event.monitor.name } : {}),
      ...(event.incident ? { incidentId: event.incident.id } : {}),
      ...(event.maintenance ? { maintenanceId: event.maintenance.id } : {}),
      createdAt: event.occurredAt,
    });
  } catch {
    // A log failure must have the same isolation guarantees as channel failures.
  }
}

function deliveryAttempts(value: unknown): number {
  if (
    value &&
    typeof value === "object" &&
    "attempts" in value &&
    typeof (value as NotificationDeliveryResult).attempts === "number"
  ) {
    return Math.max(
      1,
      Math.trunc((value as NotificationDeliveryResult).attempts!),
    );
  }
  return 1;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
