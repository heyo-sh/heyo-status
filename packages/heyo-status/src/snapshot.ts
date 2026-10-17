import { isPublicIncident } from "./incident-visibility";
import type {
  CheckResult,
  DailySummary,
  DaySnapshot,
  Incident,
  LatencySample,
  Maintenance,
  MonitorGroup,
  MonitorGroupStatus,
  MonitorSnapshot,
  OverallStatus,
  SnapshotData,
  StatusMonitorConfig,
  StatusPageConfig,
  StatusSnapshot,
} from "./types";

const dayMs = 24 * 60 * 60 * 1000;
const hourMs = 60 * 60 * 1000;
const minuteMs = 60 * 1000;
/** Hourly buckets shown by the latency sparkline before falling back to days. */
const latencyHours = 24;
const latencyFallbackDays = 7;

interface DayAggregate {
  name: string;
  dayStartAt: Date;
  totalChecks: number;
  downChecks: number;
  downMinutes: number;
  totalLatencyMs: number;
  latestStatus: boolean;
  latestCheckedAt: Date;
  latestLatencyMs: number | null;
}

interface AggregateCollection {
  byMonitor: Map<string, DayAggregate[]>;
  rawByMonitor: Map<string, CheckResult[]>;
}

/**
 * Creates the public status-page payload from configured monitors and persisted
 * raw/daily check history. The optional clock makes consumers and tests
 * deterministic while production callers can simply omit it.
 */
export function buildStatusSnapshot(
  config: StatusPageConfig,
  data: SnapshotData,
  now = new Date(),
  incidents: Incident[] = [],
  maintenance: Maintenance[] = [],
): StatusSnapshot {
  assertValidDate(now, "now");

  const publicMonitors = config.monitors.filter((monitor) => !monitor.private);
  const monitorNames = new Set(publicMonitors.map((monitor) => monitor.name));
  const aggregates = collectAggregates(data, monitorNames, now);
  const gridStart = new Date(
    utcDayStartMs(now) - (config.checks.displayDays - 1) * dayMs,
  );
  const gridDays = Array.from(
    { length: config.checks.displayDays },
    (_, index) => new Date(gridStart.getTime() + index * dayMs),
  );

  const monitors = publicMonitors.map((monitor) =>
    buildMonitorSnapshot(monitor, aggregates, gridDays, now),
  );
  const groups = buildGroups(publicMonitors, monitors);
  const hasData = monitors.some((monitor) => monitor.latestCheckedAt !== null);

  const activeIncidents = incidents.filter(
    (incident) =>
      incident.status !== "resolved" && isPublicIncident(config, incident),
  );
  // Both upcoming and running windows are public: dropping in-progress ones
  // would leave the page reporting "Under Maintenance" with nothing to explain
  // it, and would disagree with GET /maintenance, which lists them.
  const scheduledMaintenances = maintenance.filter(
    (window) => window.status !== "completed",
  );

  return {
    generatedAt: new Date(now),
    retentionDays: config.checks.retentionDays,
    displayDays: config.checks.displayDays,
    overall: calculateOverall(monitors, activeIncidents, scheduledMaintenances),
    groups,
    monitors,
    activeIncidents,
    scheduledMaintenances,
    hasConfig: publicMonitors.length > 0,
    hasData,
  };
}

/** Loads persisted history and builds a status snapshot in one operation. */
export async function getStatusSnapshot(
  config: StatusPageConfig,
  now = new Date(),
): Promise<StatusSnapshot> {
  assertValidDate(now, "now");
  const monitorNames = config.monitors
    .filter((monitor) => !monitor.private)
    .map((monitor) => monitor.name);
  const [data, incidents, maintenance] = await Promise.all([
    config.database.getSnapshot(monitorNames, config.checks.displayDays, now),
    config.incidents.enabled
      ? config.database.listIncidents({
          status: ["investigating", "identified", "monitoring"],
        })
      : Promise.resolve([]),
    config.maintenance.enabled
      ? config.database.listUpcoming(now)
      : Promise.resolve([]),
  ]);
  return buildStatusSnapshot(config, data, now, incidents, maintenance);
}

function collectAggregates(
  data: SnapshotData,
  monitorNames: ReadonlySet<string>,
  now: Date,
): AggregateCollection {
  const summariesByKey = new Map<string, DailySummary>();
  for (const summary of data.dailySummaries) {
    if (!monitorNames.has(summary.name)) continue;
    if (
      !isValidDate(summary.dayStartAt) ||
      !isValidDate(summary.latestCheckedAt)
    )
      continue;
    summariesByKey.set(dayKey(summary.name, summary.dayStartAt), summary);
  }

  const rawByDay = new Map<string, CheckResult[]>();
  const rawByMonitor = new Map<string, CheckResult[]>();
  for (const result of data.results) {
    if (!monitorNames.has(result.name) || !isValidDate(result.checkedAt))
      continue;
    const key = dayKey(result.name, result.checkedAt);
    // A persisted summary is authoritative for that day. This also prevents
    // accidental double counting during a compaction retry.
    if (summariesByKey.has(key)) continue;

    const dayResults = rawByDay.get(key);
    if (dayResults) dayResults.push(result);
    else rawByDay.set(key, [result]);

    const monitorResults = rawByMonitor.get(result.name);
    if (monitorResults) monitorResults.push(result);
    else rawByMonitor.set(result.name, [result]);
  }

  const byMonitor = new Map<string, DayAggregate[]>();
  for (const summary of summariesByKey.values()) {
    addAggregate(byMonitor, aggregateFromSummary(summary));
  }
  for (const results of rawByDay.values()) {
    const aggregate = aggregateFromResults(results, now);
    if (aggregate) addAggregate(byMonitor, aggregate);
  }

  for (const aggregates of byMonitor.values()) {
    aggregates.sort(
      (left, right) => left.dayStartAt.getTime() - right.dayStartAt.getTime(),
    );
  }
  for (const results of rawByMonitor.values()) {
    results.sort(
      (left, right) => left.checkedAt.getTime() - right.checkedAt.getTime(),
    );
  }

  return { byMonitor, rawByMonitor };
}

function buildMonitorSnapshot(
  monitor: StatusMonitorConfig,
  aggregates: AggregateCollection,
  gridDays: Date[],
  now: Date,
): MonitorSnapshot {
  const monitorAggregates = aggregates.byMonitor.get(monitor.name) ?? [];
  const aggregateByDay = new Map(
    monitorAggregates.map((aggregate) => [
      aggregate.dayStartAt.getTime(),
      aggregate,
    ]),
  );
  const totals = sumAggregates(monitorAggregates);
  const latest = latestAggregate(monitorAggregates);
  const latestRaw = latestResult(
    aggregates.rawByMonitor.get(monitor.name) ?? [],
  );
  const latestLatencyMs =
    latestRaw &&
    (!latest ||
      latestRaw.checkedAt.getTime() >= latest.latestCheckedAt.getTime())
      ? latestRaw.latencyMs
      : (latest?.latestLatencyMs ?? null);

  return {
    name: monitor.name,
    type: monitor.type,
    ...(monitor.description ? { description: monitor.description } : {}),
    ...(monitor.group ? { group: monitor.group } : {}),
    latestStatus: latest?.latestStatus ?? null,
    latestCheckedAt: latest ? new Date(latest.latestCheckedAt) : null,
    latestLatencyMs,
    uptimePercent: uptimePercent(totals),
    uptimePercent24h: periodUptime(
      monitorAggregates,
      aggregates.rawByMonitor.get(monitor.name) ?? [],
      new Date(now.getTime() - 24 * hourMs),
    ),
    uptimePercent7d: periodUptime(
      monitorAggregates,
      aggregates.rawByMonitor.get(monitor.name) ?? [],
      new Date(now.getTime() - 7 * dayMs),
    ),
    uptimePercent30d: periodUptime(
      monitorAggregates,
      aggregates.rawByMonitor.get(monitor.name) ?? [],
      new Date(now.getTime() - 30 * dayMs),
    ),
    uptimePercent90d: periodUptime(
      monitorAggregates,
      aggregates.rawByMonitor.get(monitor.name) ?? [],
      new Date(now.getTime() - 90 * dayMs),
    ),
    avgLatencyMs:
      totals.totalChecks === 0
        ? null
        : Math.round(totals.totalLatencyMs / totals.totalChecks),
    days: gridDays.map((day) =>
      toDaySnapshot(aggregateByDay.get(day.getTime()), day),
    ),
    latencySeries: buildLatencySeries(
      monitorAggregates,
      aggregates.rawByMonitor.get(monitor.name) ?? [],
      now,
    ),
  };
}

/**
 * Builds the sparkline series: hourly averages across the last 24 hours when
 * raw observations are still retained, otherwise daily averages from compacted
 * history. Empty buckets are omitted rather than reported as zero latency.
 */
function buildLatencySeries(
  aggregates: DayAggregate[],
  rawResults: CheckResult[],
  now: Date,
): LatencySample[] {
  const firstHourMs = utcHourStartMs(now) - (latencyHours - 1) * hourMs;
  const buckets = new Map<number, { totalLatencyMs: number; checks: number }>();

  for (const result of rawResults) {
    const checkedAtMs = result.checkedAt.getTime();
    if (checkedAtMs < firstHourMs || checkedAtMs > now.getTime()) continue;
    const bucketMs = utcHourStartMs(result.checkedAt);
    const bucket = buckets.get(bucketMs) ?? { totalLatencyMs: 0, checks: 0 };
    bucket.totalLatencyMs += Math.max(0, result.latencyMs);
    bucket.checks += 1;
    buckets.set(bucketMs, bucket);
  }

  if (buckets.size > 0) {
    return [...buckets.entries()]
      .sort(([left], [right]) => left - right)
      .map(([bucketMs, bucket]) => ({
        key: new Date(bucketMs).toISOString(),
        label: formatHourLabel(new Date(bucketMs)),
        at: new Date(bucketMs),
        latencyMs: Math.round(bucket.totalLatencyMs / bucket.checks),
        totalChecks: bucket.checks,
      }));
  }

  const firstDayMs = utcDayStartMs(now) - (latencyFallbackDays - 1) * dayMs;
  return aggregates
    .filter(
      (aggregate) =>
        aggregate.totalChecks > 0 &&
        aggregate.dayStartAt.getTime() >= firstDayMs,
    )
    .map((aggregate) => ({
      key: aggregate.dayStartAt.toISOString(),
      label: formatDayLabel(aggregate.dayStartAt),
      at: new Date(aggregate.dayStartAt),
      latencyMs: Math.round(aggregate.totalLatencyMs / aggregate.totalChecks),
      totalChecks: aggregate.totalChecks,
    }));
}

function buildGroups(
  configuredMonitors: StatusMonitorConfig[],
  snapshots: MonitorSnapshot[],
): MonitorGroup[] {
  const snapshotByName = new Map(
    snapshots.map((snapshot) => [snapshot.name, snapshot]),
  );
  const groupMonitors = new Map<string, string[]>();

  for (const monitor of configuredMonitors) {
    if (!monitor.group) continue;
    const names = groupMonitors.get(monitor.group);
    if (names) names.push(monitor.name);
    else groupMonitors.set(monitor.group, [monitor.name]);
  }

  return [...groupMonitors].map(([name, monitors]) => {
    const statuses = monitors
      .map((monitorName) => snapshotByName.get(monitorName)?.latestStatus)
      .filter(
        (status): status is boolean => status !== undefined && status !== null,
      );
    return {
      name,
      monitors,
      status: calculateGroupStatus(statuses, monitors.length),
    };
  });
}

function calculateOverall(
  monitors: MonitorSnapshot[],
  incidents: Incident[],
  maintenance: Maintenance[],
): OverallStatus {
  if (maintenance.some((window) => window.status === "in-progress")) {
    return "maintenance";
  }
  if (incidents.some((incident) => incident.severity === "critical")) {
    return "major-outage";
  }
  if (incidents.length > 0) return "degraded";

  const failed = monitors.filter((monitor) => monitor.latestStatus === false);
  if (failed.length === 0) return "operational";
  return failed.length === monitors.length ? "major-outage" : "degraded";
}

function calculateGroupStatus(
  statuses: boolean[],
  configuredCount: number,
): MonitorGroupStatus {
  const failed = statuses.filter((status) => !status).length;
  if (failed === 0) return "operational";
  return failed === configuredCount ? "outage" : "degraded";
}

function toDaySnapshot(
  aggregate: DayAggregate | undefined,
  dayStartAt: Date,
): DaySnapshot {
  const key = dayKey("", dayStartAt).slice(1);
  const label = formatDayLabel(dayStartAt);
  if (!aggregate || aggregate.totalChecks === 0) {
    return {
      key,
      label,
      status: "empty",
      tooltip: `No data for ${label}`,
      totalChecks: 0,
      downChecks: 0,
      downMinutes: 0,
      downPercent: 0,
    };
  }

  const downPercent = roundPercent(
    (aggregate.downChecks / aggregate.totalChecks) * 100,
  );
  const uptime = roundPercent(100 - downPercent);
  const status =
    aggregate.downChecks === 0
      ? "up"
      : aggregate.downChecks === aggregate.totalChecks
        ? "down"
        : "degraded";
  const checksLabel = `${aggregate.totalChecks} ${aggregate.totalChecks === 1 ? "check" : "checks"}`;
  const failuresLabel =
    aggregate.downChecks === 0
      ? ""
      : ` — ${aggregate.downChecks} ${aggregate.downChecks === 1 ? "failure" : "failures"}`;

  return {
    key,
    label,
    status,
    tooltip: `${uptime}% uptime — ${checksLabel}${failuresLabel}`,
    totalChecks: aggregate.totalChecks,
    downChecks: aggregate.downChecks,
    downMinutes: aggregate.downMinutes,
    downPercent,
  };
}

function aggregateFromSummary(summary: DailySummary): DayAggregate {
  return {
    name: summary.name,
    dayStartAt: new Date(utcDayStartMs(summary.dayStartAt)),
    totalChecks: Math.max(0, summary.totalChecks),
    downChecks: Math.max(0, summary.downChecks),
    downMinutes: Math.max(0, summary.downMinutes),
    totalLatencyMs: Math.max(0, summary.totalLatencyMs),
    latestStatus: summary.latestStatus,
    latestCheckedAt: new Date(summary.latestCheckedAt),
    latestLatencyMs: null,
  };
}

function aggregateFromResults(
  unsortedResults: CheckResult[],
  now: Date,
): DayAggregate | null {
  const results = [...unsortedResults].sort(
    (left, right) => left.checkedAt.getTime() - right.checkedAt.getTime(),
  );
  const first = results[0];
  const latest = results.at(-1);
  if (!first || !latest) return null;

  const dayStartMs = utcDayStartMs(first.checkedAt);
  const dayEndMs = dayStartMs + dayMs;
  const effectiveDayEnd = Math.min(dayEndMs, now.getTime());
  let downChecks = 0;
  let downMs = 0;
  let totalLatencyMs = 0;

  for (const [index, result] of results.entries()) {
    totalLatencyMs += Math.max(0, result.latencyMs);
    if (result.status) continue;

    downChecks += 1;
    const next = results[index + 1];
    const endedAt = Math.min(
      next?.checkedAt.getTime() ?? effectiveDayEnd,
      effectiveDayEnd,
    );
    downMs += Math.max(0, endedAt - result.checkedAt.getTime());
  }

  return {
    name: first.name,
    dayStartAt: new Date(dayStartMs),
    totalChecks: results.length,
    downChecks,
    downMinutes: Math.ceil(downMs / minuteMs),
    totalLatencyMs,
    latestStatus: latest.status,
    latestCheckedAt: new Date(latest.checkedAt),
    latestLatencyMs: latest.latencyMs,
  };
}

function periodUptime(
  aggregates: DayAggregate[],
  rawResults: CheckResult[],
  from: Date,
): number | null {
  const firstFullDayMs = utcDayStartMs(from);
  // Daily summaries cannot be split into sub-day ranges. Include their calendar
  // day; raw observations retain their timestamps and are filtered precisely.
  const summaryTotals = sumAggregates(
    aggregates.filter(
      (aggregate) =>
        aggregate.latestLatencyMs === null &&
        aggregate.dayStartAt.getTime() >= firstFullDayMs,
    ),
  );
  const rawTotals = sumResults(
    rawResults.filter((result) => result.checkedAt.getTime() >= from.getTime()),
  );
  return uptimePercent({
    totalChecks: summaryTotals.totalChecks + rawTotals.totalChecks,
    downChecks: summaryTotals.downChecks + rawTotals.downChecks,
  });
}

function sumAggregates(aggregates: DayAggregate[]) {
  return aggregates.reduce(
    (totals, aggregate) => ({
      totalChecks: totals.totalChecks + aggregate.totalChecks,
      downChecks: totals.downChecks + aggregate.downChecks,
      totalLatencyMs: totals.totalLatencyMs + aggregate.totalLatencyMs,
    }),
    { totalChecks: 0, downChecks: 0, totalLatencyMs: 0 },
  );
}

function sumResults(results: CheckResult[]) {
  return results.reduce(
    (totals, result) => ({
      totalChecks: totals.totalChecks + 1,
      downChecks: totals.downChecks + (result.status ? 0 : 1),
      totalLatencyMs: totals.totalLatencyMs + Math.max(0, result.latencyMs),
    }),
    { totalChecks: 0, downChecks: 0, totalLatencyMs: 0 },
  );
}

function uptimePercent(totals: {
  totalChecks: number;
  downChecks: number;
}): number | null {
  if (totals.totalChecks === 0) return null;
  return roundPercent(
    ((totals.totalChecks - totals.downChecks) / totals.totalChecks) * 100,
  );
}

function latestAggregate(aggregates: DayAggregate[]): DayAggregate | undefined {
  return aggregates.reduce<DayAggregate | undefined>(
    (latest, aggregate) =>
      !latest ||
      aggregate.latestCheckedAt.getTime() > latest.latestCheckedAt.getTime()
        ? aggregate
        : latest,
    undefined,
  );
}

function latestResult(results: CheckResult[]): CheckResult | undefined {
  return results.at(-1);
}

function addAggregate(
  byMonitor: Map<string, DayAggregate[]>,
  aggregate: DayAggregate,
): void {
  const values = byMonitor.get(aggregate.name);
  if (values) values.push(aggregate);
  else byMonitor.set(aggregate.name, [aggregate]);
}

function dayKey(name: string, date: Date): string {
  const day = new Date(utcDayStartMs(date));
  return `${name}\u0000${day.toISOString().slice(0, 10)}`;
}

function utcDayStartMs(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function utcHourStartMs(date: Date): number {
  return Math.floor(date.getTime() / hourMs) * hourMs;
}

function formatHourLabel(date: Date): string {
  const hour = String(date.getUTCHours()).padStart(2, "0");
  return `${formatDayLabel(date)}, ${hour}:00 UTC`;
}

function formatDayLabel(date: Date): string {
  const month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][date.getUTCMonth()];
  return `${month} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function isValidDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

function assertValidDate(value: Date, name: string): void {
  if (!isValidDate(value)) throw new Error(`${name} must be a valid Date.`);
}
