"use client";

import { Badge, cn, Empty, StatusDot } from "@heyo-sh/heyo-ui";

import type { MonitorGroup, MonitorSnapshot } from "../../types";
import { uptimeForPeriod } from "../../uptime";
import {
  ActiveIncidents,
  ChevronIcon,
  currentStatusLabel,
  currentStatusLevel,
  formatTimestamp,
  formatUptime,
  monitorStatusLabel,
  monitorStatusVariant,
  ScheduledMaintenance,
  StatusBanner,
  StatusFooter,
  StatusHeader,
  StatusShell,
  type StatusMetricsOptions,
} from "../../ui/primitives";
import type { HeyoStatusTheme, StatusLayoutProps } from "../contract";

/**
 * Dune — a directory: every service category is a table and every monitor in
 * it is a row with its own status.
 *
 * It is the theme for a platform with many small components, where the
 * question is usually "which part of it is down?" and a page of cards would
 * make that take scrolling.
 */
function DuneLayout({
  snapshot,
  title,
  branding,
  groups,
  ungroupedMonitors,
  metrics,
  rssHref,
  subscribersEnabled,
  subscribeHref,
  onSubscribe,
  showPoweredBy,
  className,
}: StatusLayoutProps) {
  const ungrouped: MonitorGroup | undefined =
    ungroupedMonitors.length > 0
      ? {
          name: groups.length > 0 ? "Other services" : "Services",
          status: aggregateStatus(ungroupedMonitors),
          monitors: ungroupedMonitors.map((monitor) => monitor.name),
        }
      : undefined;

  return (
    <StatusShell className={cn("gap-6", className)} theme="dune">
      <StatusHeader
        branding={branding}
        onSubscribe={onSubscribe}
        subscribeHref={subscribeHref}
        subscribersEnabled={subscribersEnabled}
        title={title}
      />

      <StatusBanner
        caption={`Updated ${formatTimestamp(snapshot.generatedAt)}`}
        status={snapshot.overall}
      />

      <ActiveIncidents
        incidents={snapshot.activeIncidents}
        now={snapshot.generatedAt}
      />
      <ScheduledMaintenance
        maintenance={snapshot.scheduledMaintenances}
        now={snapshot.generatedAt}
      />

      <section aria-label="Monitors" className="flex flex-col gap-4">
        {groups.map(({ group, monitors }) => (
          <ServiceGroup
            group={group}
            key={group.name}
            metrics={metrics}
            monitors={monitors}
          />
        ))}
        {ungrouped ? (
          <ServiceGroup
            group={ungrouped}
            metrics={metrics}
            monitors={ungroupedMonitors}
          />
        ) : null}
        {!snapshot.hasConfig ? (
          <Empty
            bordered
            description="Add a monitor to start publishing uptime history."
            title="No monitors configured"
          />
        ) : null}
      </section>

      <Legend />

      <StatusFooter
        className="mt-auto"
        generatedAt={snapshot.generatedAt}
        rssHref={rssHref}
        showPoweredBy={showPoweredBy}
      />
    </StatusShell>
  );
}

/**
 * A category and its subcomponents. The disclosure is a native `<details>`, so
 * the whole directory still opens and closes without the JavaScript bundle.
 */
function ServiceGroup({
  group,
  monitors,
  metrics,
}: {
  group: MonitorGroup;
  monitors: MonitorSnapshot[];
  metrics?: StatusMetricsOptions;
}) {
  const showUptimePercent = metrics?.showUptimePercent ?? true;

  return (
    <details
      className="group/disclosure overflow-hidden rounded-lg ring-1 ring-heyo-hairline"
      data-slot="status-monitor-group"
      open
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 bg-heyo-recessed px-4 py-3 text-sm font-medium text-heyo-strong [&::-webkit-details-marker]:hidden">
        <ChevronIcon className="size-3.5 shrink-0 text-heyo-subtle transition-transform duration-100 group-open/disclosure:rotate-90" />
        <span className="min-w-0 flex-1 truncate">{group.name}</span>
        <Badge dot variant={monitorStatusVariant(group.status)}>
          {monitorStatusLabel(group.status)}
        </Badge>
      </summary>
      <div className="divide-y divide-heyo-hairline bg-heyo-base">
        {monitors.map((monitor) => (
          <div
            className="flex min-w-0 items-center gap-3 px-4 py-2"
            data-slot="status-monitor"
            key={monitor.name}
          >
            {/*
             * A bare dot, not a labelled badge. The group header already
             * names the state, and repeating "Operational" on every row
             * below it turned the right edge into a column of identical
             * pills — the one thing that differs, a row that is not
             * operational, was the hardest thing on the page to spot. The
             * dot still carries the state for a screen reader.
             */}
            <StatusDot
              aria-label={currentStatusLabel(monitor.latestStatus)}
              role="img"
              status={currentStatusLevel(monitor.latestStatus)}
            />
            {/*
             * Name and description share a line rather than stacking: this
             * is the directory theme, and halving the row height is the
             * whole reason to pick it.
             */}
            <div className="flex min-w-0 flex-1 items-baseline gap-2">
              <h3 className="m-0 shrink-0 text-sm text-heyo-default">
                {monitor.name}
              </h3>
              {monitor.description ? (
                <p className="m-0 hidden truncate text-xs text-heyo-subtle sm:block">
                  {monitor.description}
                </p>
              ) : null}
            </div>
            {showUptimePercent ? (
              <span className="shrink-0 text-xs tabular-nums text-heyo-subtle">
                {formatUptime(uptimeForPeriod(monitor, "30d"))} · 30d
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </details>
  );
}

/** What the colours mean, printed once instead of guessed per row. */
function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-heyo-subtle">
      {(["operational", "degraded", "down", "maintenance"] as const).map(
        (level) => (
          <span className="inline-flex items-center gap-2" key={level}>
            <StatusDot status={level} />
            {legendLabel(level)}
          </span>
        ),
      )}
    </div>
  );
}

function legendLabel(
  level: "operational" | "degraded" | "down" | "maintenance",
): string {
  switch (level) {
    case "operational":
      return "Operational";
    case "degraded":
      return "Degraded performance";
    case "down":
      return "Outage";
    case "maintenance":
      return "Under maintenance";
  }
}

/** Group status for monitors the configuration left ungrouped. */
function aggregateStatus(monitors: MonitorSnapshot[]): MonitorGroup["status"] {
  const down = monitors.filter(
    (monitor) => monitor.latestStatus === false,
  ).length;
  if (down === 0) return "operational";
  return down === monitors.length ? "outage" : "degraded";
}

export const duneTheme: HeyoStatusTheme = {
  name: "dune",
  Layout: DuneLayout,
};
