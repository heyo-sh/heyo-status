import { uptimeForPeriod } from "./uptime";
import type { MonitorSnapshot, StatusSnapshot, UptimePeriod } from "./types";

/** Which value an embeddable badge renders on its right-hand side. */
export type BadgeMetric = "status" | "uptime" | "latency";

export interface BadgeOptions {
  /** Left-hand label. Defaults to the monitor name, or "status" for the page. */
  label?: string;
  metric?: BadgeMetric;
  /** Reporting period for the uptime metric. Defaults to 24h. */
  period?: UptimePeriod;
}

interface BadgeContent {
  label: string;
  message: string;
  color: string;
}

const colors = {
  up: "#22c55e",
  degraded: "#f59e0b",
  down: "#ef4444",
  unknown: "#9ca3af",
  info: "#2563eb",
  label: "#374151",
};

const fontSize = 11;
const height = 20;
const padding = 6;
/** Average advance width of DejaVu Sans at 11px, the shields.io convention. */
const averageCharWidth = 6.2;

/** Renders an embeddable SVG badge for a single monitor. */
export function createMonitorBadge(
  monitor: MonitorSnapshot,
  options: BadgeOptions = {},
): string {
  return renderBadge(monitorBadgeContent(monitor, options));
}

/** Renders an embeddable SVG badge for the overall status-page state. */
export function createOverallBadge(
  snapshot: StatusSnapshot,
  options: BadgeOptions = {},
): string {
  const overall = snapshot.overall;
  return renderBadge({
    label: options.label?.trim() || "status",
    message:
      overall === "operational"
        ? "operational"
        : overall === "degraded"
          ? "degraded"
          : overall === "major-outage"
            ? "major outage"
            : "maintenance",
    color:
      overall === "operational"
        ? colors.up
        : overall === "degraded"
          ? colors.degraded
          : overall === "major-outage"
            ? colors.down
            : colors.info,
  });
}

function monitorBadgeContent(
  monitor: MonitorSnapshot,
  options: BadgeOptions,
): BadgeContent {
  const label = options.label?.trim() || monitor.name;
  const metric = options.metric ?? "status";

  if (metric === "uptime") {
    const period = options.period ?? "24h";
    const uptime = uptimeForPeriod(monitor, period);
    return {
      label,
      message: uptime === null ? "no data" : `${formatPercent(uptime)}%`,
      color:
        uptime === null
          ? colors.unknown
          : uptime >= 99.9
            ? colors.up
            : uptime >= 95
              ? colors.degraded
              : colors.down,
    };
  }

  if (metric === "latency") {
    const latency = monitor.latestLatencyMs ?? monitor.avgLatencyMs;
    return {
      label,
      message: latency === null ? "no data" : `${Math.round(latency)} ms`,
      color: latency === null ? colors.unknown : colors.info,
    };
  }

  return {
    label,
    message:
      monitor.latestStatus === null
        ? "no data"
        : monitor.latestStatus
          ? "operational"
          : "outage",
    color:
      monitor.latestStatus === null
        ? colors.unknown
        : monitor.latestStatus
          ? colors.up
          : colors.down,
  };
}

function renderBadge(content: BadgeContent): string {
  const labelWidth = textWidth(content.label);
  const messageWidth = textWidth(content.message);
  const totalWidth = labelWidth + messageWidth;
  const accessibleText = `${content.label}: ${content.message}`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}" role="img" aria-label="${escapeXml(accessibleText)}">`,
    `<title>${escapeXml(accessibleText)}</title>`,
    `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset=".1" stop-color="#aaa" stop-opacity=".1"/><stop offset=".9" stop-color="#000" stop-opacity=".3"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient>`,
    `<clipPath id="r"><rect width="${totalWidth}" height="${height}" rx="3" fill="#fff"/></clipPath>`,
    `<g clip-path="url(#r)">`,
    `<rect width="${labelWidth}" height="${height}" fill="${colors.label}"/>`,
    `<rect x="${labelWidth}" width="${messageWidth}" height="${height}" fill="${content.color}"/>`,
    `<rect width="${totalWidth}" height="${height}" fill="url(#s)"/>`,
    `</g>`,
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="${fontSize}">`,
    textElement(content.label, labelWidth / 2),
    textElement(content.message, labelWidth + messageWidth / 2),
    `</g>`,
    `</svg>`,
  ].join("");
}

function textElement(value: string, center: number): string {
  const escaped = escapeXml(value);
  const x = round(center);
  return (
    `<text x="${x}" y="15" fill="#010101" fill-opacity=".3">${escaped}</text>` +
    `<text x="${x}" y="14">${escaped}</text>`
  );
}

function textWidth(value: string): number {
  return Math.ceil(value.length * averageCharWidth) + padding * 2;
}

function formatPercent(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
