import type { MonitorSnapshot, UptimePeriod } from "./types";

/**
 * Maps a configured uptime period to its value on a monitor snapshot.
 *
 * The UI, the SVG badges and the Prometheus exposition all read the same
 * function, so a period can never mean one window in one surface and a
 * different window in another.
 */
export function uptimeForPeriod(
  monitor: MonitorSnapshot,
  period: UptimePeriod,
): number | null {
  switch (period) {
    case "24h":
      return monitor.uptimePercent24h;
    case "7d":
      return monitor.uptimePercent7d;
    case "30d":
      return monitor.uptimePercent30d;
    case "90d":
      return monitor.uptimePercent90d;
  }
}
