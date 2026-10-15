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
 * so ninety days fit a phone without a horizontal scroller. Each column keeps
 * the aggregate in a native tooltip and the whole bar is labelled, so the daily
 * figures stay available to a screen reader and without a pointer.
 */
export function DayGrid({ days, monitorName, className }: DayGridProps) {
  if (days.length === 0) return null;

  const ticks: StatusTick[] = days.map((day) => ({
    status: tickStatus(day),
    label: `${day.label}: ${day.tooltip}`,
  }));

  return (
    <StatusBar
      aria-label={`${monitorName} daily uptime history`}
      className={className}
      legend={[days[0]!.label, days.at(-1)!.label]}
      role="img"
      size="base"
      ticks={ticks}
    />
  );
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
