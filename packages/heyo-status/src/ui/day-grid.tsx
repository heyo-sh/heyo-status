"use client";

import { StatusBar, type StatusLevel, type StatusTick } from "@heyo-sh/heyo-ui";

import type { DaySnapshot } from "../types";

export interface DayGridProps {
  /** Daily status aggregates, ordered from oldest to newest. */
  days: DaySnapshot[];
  monitorName: string;
  className?: string;
}

/**
 * The uptime history bar: one column per day, coloured by what happened.
 *
 * It is heyo-ui's `StatusBar`, which flexes its columns instead of sizing them,
 * so ninety days fit a phone without a horizontal scroller. Each column has a
 * hover/focus tooltip and an accessible name with the exact daily aggregate.
 */
export function DayGrid({ days, monitorName, className }: DayGridProps) {
  if (days.length === 0) return null;

  const ticks: StatusTick[] = days.map((day) => ({
    status: tickStatus(day),
    label:
      day.status === "empty"
        ? day.tooltip
        : `${day.label}: ${day.tooltip} — ${day.downPercent}% unavailable`,
    tooltip: <DayTooltip day={day} />,
    // The healthy share is above the unavailable share. Unknown days keep the
    // solid "unknown" tick instead of pretending that missing data is uptime.
    segments:
      day.status === "degraded"
        ? [
            { status: "operational", percent: 100 - day.downPercent },
            { status: "down", percent: day.downPercent },
          ]
        : undefined,
  }));

  return (
    <StatusBar
      aria-label={`${monitorName} daily uptime history`}
      className={className}
      legend={[days[0]!.label, days.at(-1)!.label]}
      role="group"
      size="base"
      ticks={ticks}
    />
  );
}

function DayTooltip({ day }: { day: DaySnapshot }) {
  return (
    <span className="flex flex-col gap-1">
      <span className="font-semibold">{longDayLabel(day)}</span>
      <span>{dayStatusSummary(day)}</span>
      {day.status !== "empty" && (
        <>
          <span>
            {Math.round((100 - day.downPercent) * 100) / 100}% uptime ·{" "}
            {day.downPercent}% unavailable
          </span>
          <span>
            {day.totalChecks} {day.totalChecks === 1 ? "check" : "checks"}
            {day.downChecks > 0 && (
              <>
                {" · "}
                {day.downChecks} {day.downChecks === 1 ? "failure" : "failures"}
              </>
            )}
          </span>
        </>
      )}
    </span>
  );
}

/** Match the full UTC dates and ordinal days used by paragraph/status-page. */
function longDayLabel(day: DaySnapshot): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day.key)) return day.label;
  const date = new Date(`${day.key}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return day.label;

  const dayOfMonth = date.getUTCDate();
  const suffix = ordinalSuffix(dayOfMonth);
  const weekday = date.toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
  const month = date.toLocaleDateString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
  return `${weekday}, ${month} ${dayOfMonth}${suffix}, ${date.getUTCFullYear()}`;
}

function ordinalSuffix(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return "th";
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

function dayStatusSummary(day: DaySnapshot): string {
  if (day.status === "empty") return "No checks";
  if (day.status === "up") return "Status OK";
  if (day.downMinutes === 0) return "Failed checks recorded";
  return `DOWN for ${day.downMinutes} ${day.downMinutes === 1 ? "minute" : "minutes"}`;
}

function tickStatus(day: DaySnapshot): StatusLevel {
  switch (day.status) {
    case "up":
      return "operational";
    case "down":
      return "down";
    case "degraded":
      return "degraded";
    case "empty":
      return "unknown";
  }
}
