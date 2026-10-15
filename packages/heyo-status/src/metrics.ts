import { uptimeForPeriod } from "./uptime";
import type {
  MonitorSnapshot,
  OverallStatus,
  StatusSnapshot,
  UptimePeriod,
} from "./types";

/** Content type of the Prometheus text exposition format. */
export const prometheusContentType = "text/plain; version=0.0.4; charset=utf-8";

const overallStates: OverallStatus[] = [
  "operational",
  "degraded",
  "major-outage",
  "maintenance",
];
const uptimePeriods: UptimePeriod[] = ["24h", "7d", "30d", "90d"];

/**
 * Renders a public snapshot as Prometheus metrics. Only aggregate, already
 * public data is exposed — no incident content and no monitor targets.
 */
export function createPrometheusMetrics(snapshot: StatusSnapshot): string {
  const lines: string[] = [];

  metric(
    lines,
    "heyo_status_up",
    "Current monitor status (1 = operational, 0 = failing).",
    snapshot.monitors.flatMap((monitor) =>
      monitor.latestStatus === null
        ? []
        : [
            sample(
              "heyo_status_up",
              monitorLabels(monitor),
              monitor.latestStatus ? 1 : 0,
            ),
          ],
    ),
  );

  metric(
    lines,
    "heyo_status_latency_milliseconds",
    "Latency of the most recent check in milliseconds.",
    snapshot.monitors.flatMap((monitor) =>
      monitor.latestLatencyMs === null
        ? []
        : [
            sample(
              "heyo_status_latency_milliseconds",
              monitorLabels(monitor),
              monitor.latestLatencyMs,
            ),
          ],
    ),
  );

  metric(
    lines,
    "heyo_status_uptime_ratio",
    "Uptime ratio per reporting period (0-1).",
    snapshot.monitors.flatMap((monitor) =>
      uptimePeriods.flatMap((period) => {
        const uptime = uptimeForPeriod(monitor, period);
        return uptime === null
          ? []
          : [
              sample(
                "heyo_status_uptime_ratio",
                { monitor: monitor.name, period },
                round(uptime / 100),
              ),
            ];
      }),
    ),
  );

  metric(
    lines,
    "heyo_status_last_check_timestamp_seconds",
    "Unix timestamp of the most recent check.",
    snapshot.monitors.flatMap((monitor) =>
      monitor.latestCheckedAt === null
        ? []
        : [
            sample(
              "heyo_status_last_check_timestamp_seconds",
              { monitor: monitor.name },
              seconds(monitor.latestCheckedAt),
            ),
          ],
    ),
  );

  metric(
    lines,
    "heyo_status_overall",
    "Overall status of the page; 1 marks the active state.",
    overallStates.map((state) =>
      sample(
        "heyo_status_overall",
        { status: state },
        snapshot.overall === state ? 1 : 0,
      ),
    ),
  );

  metric(lines, "heyo_status_monitors", "Number of public monitors.", [
    sample("heyo_status_monitors", {}, snapshot.monitors.length),
  ]);

  metric(
    lines,
    "heyo_status_active_incidents",
    "Number of unresolved incidents.",
    [
      sample(
        "heyo_status_active_incidents",
        {},
        snapshot.activeIncidents.length,
      ),
    ],
  );

  metric(
    lines,
    "heyo_status_scheduled_maintenances",
    "Number of scheduled maintenance windows.",
    [
      sample(
        "heyo_status_scheduled_maintenances",
        {},
        snapshot.scheduledMaintenances.length,
      ),
    ],
  );

  metric(
    lines,
    "heyo_status_snapshot_timestamp_seconds",
    "Unix timestamp of the rendered snapshot.",
    [
      sample(
        "heyo_status_snapshot_timestamp_seconds",
        {},
        seconds(snapshot.generatedAt),
      ),
    ],
  );

  return `${lines.join("\n")}\n`;
}

function metric(
  lines: string[],
  name: string,
  help: string,
  samples: string[],
): void {
  if (samples.length === 0) return;
  lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, ...samples);
}

function sample(
  name: string,
  labels: Record<string, string | undefined>,
  value: number,
): string {
  const rendered = Object.entries(labels)
    .filter(([, label]) => label !== undefined && label !== "")
    .map(([key, label]) => `${key}="${escapeLabel(label as string)}"`)
    .join(",");
  return `${name}${rendered ? `{${rendered}}` : ""} ${formatValue(value)}`;
}

function monitorLabels(
  monitor: MonitorSnapshot,
): Record<string, string | undefined> {
  return { monitor: monitor.name, type: monitor.type, group: monitor.group };
}

function seconds(value: Date | string): number {
  const timestamp = value instanceof Date ? value : new Date(value);
  return Math.floor(timestamp.getTime() / 1000);
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function formatValue(value: number): string {
  return Number.isFinite(value) ? String(value) : "NaN";
}

function escapeLabel(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n");
}
