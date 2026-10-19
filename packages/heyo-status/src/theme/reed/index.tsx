"use client";

import { cn, Empty, StatusDot } from "@heyo-sh/heyo-ui";

import type { MonitorSnapshot } from "../../types";
import { uptimeForPeriod } from "../../uptime";
import { DayGrid } from "../../ui/day-grid";
import {
  ActiveIncidents,
  currentStatusLabel,
  currentStatusLevel,
  formatTimestamp,
  formatUptime,
  overallStatusLabel,
  overallStatusLevel,
  ScheduledMaintenance,
  SectionHeading,
  StatusFooter,
  StatusHeader,
  StatusShell,
  type StatusMetricsOptions,
} from "../../ui/primitives";
import type { HeyoStatusTheme, StatusLayoutProps } from "../contract";

/**
 * Reed — the narrow one: a single thin column of services and nothing else.
 *
 * Every other theme answers a question with chrome. This one removes the
 * chrome instead: no cards, no boxes, no badges, no group headers that repeat
 * a status the rows already show. What is left is a line of text per service,
 * ninety days of history under it, and one uptime figure — the page you pick
 * when the page itself should not be the thing anyone notices.
 *
 * The width is the design. A status page is read in one glance and then
 * closed, and a glance is about as wide as a paragraph.
 */
function ReedLayout({
  snapshot,
  title,
  branding,
  groups,
  ungroupedMonitors,
  metrics,
  incidentsEnabled,
  maintenanceEnabled,
  rssHref,
  subscribersEnabled,
  subscribeHref,
  onSubscribe,
  showPoweredBy,
  className,
}: StatusLayoutProps) {
  const period = historyPeriod(snapshot.displayDays);

  return (
    <StatusShell className={cn("gap-8", className)} theme="reed">
      <StatusHeader
        branding={branding}
        onSubscribe={onSubscribe}
        subscribeHref={subscribeHref}
        subscribersEnabled={subscribersEnabled}
        title={title}
      />

      <section
        aria-live="polite"
        className="flex items-center gap-3 border-b border-heyo-hairline pb-6"
        data-slot="status-overall"
        data-status={snapshot.overall}
        role="status"
      >
        <StatusDot pulse status={overallStatusLevel(snapshot.overall)} />
        <h1 className="m-0 min-w-0 flex-1 text-lg font-medium text-balance text-heyo-strong">
          {overallStatusLabel(snapshot.overall)}
        </h1>
        <p className="m-0 shrink-0 text-xs tabular-nums text-heyo-subtle">
          {formatTimestamp(snapshot.generatedAt)}
        </p>
      </section>

      <ActiveIncidents
        enabled={incidentsEnabled}
        incidents={snapshot.activeIncidents}
        now={snapshot.generatedAt}
      />
      <ScheduledMaintenance
        enabled={maintenanceEnabled}
        maintenance={snapshot.scheduledMaintenances}
        now={snapshot.generatedAt}
      />

      <section aria-label="Monitors" className="flex flex-col gap-8">
        {/*
         * A group is one quiet label above its rows — no card, no box, no
         * repeated status badge. Flattening the groups away would be simpler
         * still, but a page cannot quietly discard something its own
         * configuration asked for.
         */}
        {groups.map(({ group, monitors }) => (
          <div className="flex flex-col gap-6" key={group.name}>
            <SectionHeading>{group.name}</SectionHeading>
            {monitors.map((monitor) => (
              <ServiceRow
                key={monitor.name}
                metrics={metrics}
                monitor={monitor}
                period={period}
              />
            ))}
          </div>
        ))}
        {ungroupedMonitors.length > 0 ? (
          <div className="flex flex-col gap-6">
            <SectionHeading>
              {groups.length > 0 ? "Other" : "Services"}
            </SectionHeading>
            {ungroupedMonitors.map((monitor) => (
              <ServiceRow
                key={monitor.name}
                metrics={metrics}
                monitor={monitor}
                period={period}
              />
            ))}
          </div>
        ) : null}
        {!snapshot.hasConfig ? (
          <Empty
            bordered
            description="Add a monitor to start publishing uptime history."
            title="No monitors configured"
          />
        ) : null}
      </section>

      <StatusFooter
        className="mt-auto"
        generatedAt={snapshot.generatedAt}
        rssHref={rssHref}
        showPoweredBy={showPoweredBy}
      />
    </StatusShell>
  );
}

/** One service: a name, a history bar, and the figure that summarises it. */
function ServiceRow({
  monitor,
  metrics,
  period,
}: {
  monitor: MonitorSnapshot;
  metrics?: StatusMetricsOptions;
  period: "24h" | "7d" | "30d" | "90d";
}) {
  const showUptimePercent = metrics?.showUptimePercent ?? true;

  return (
    <article className="flex flex-col gap-2" data-slot="status-monitor">
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot
          aria-label={currentStatusLabel(monitor.latestStatus)}
          role="img"
          status={currentStatusLevel(monitor.latestStatus)}
        />
        <h3 className="m-0 min-w-0 flex-1 truncate text-sm font-medium text-heyo-strong">
          {monitor.name}
        </h3>
        {showUptimePercent ? (
          <p className="m-0 shrink-0 text-xs tabular-nums text-heyo-subtle">
            {formatUptime(uptimeForPeriod(monitor, period))}
          </p>
        ) : null}
      </div>
      <DayGrid days={monitor.days} monitorName={monitor.name} />
    </article>
  );
}

/** The widest window the retained history can actually fill. */
function historyPeriod(displayDays: number): "24h" | "7d" | "30d" | "90d" {
  if (displayDays >= 90) return "90d";
  if (displayDays >= 30) return "30d";
  if (displayDays >= 7) return "7d";
  return "24h";
}

export const reedTheme: HeyoStatusTheme = {
  name: "reed",
  Layout: ReedLayout,
};
