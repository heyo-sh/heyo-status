"use client";

import { Card, cn, Empty, StatusDot } from "@heyo-sh/heyo-ui";

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
 * Fern — one uptime number per service and ninety days of history under it.
 *
 * Everything that is not availability is removed: no cards around single
 * monitors, no latency chart, no metric grid. A visitor reads the headline,
 * then one row per service, and that is the whole page.
 */
function FernLayout({
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
    <StatusShell className={cn("gap-10", className)} theme="fern">
      <StatusHeader
        branding={branding}
        onSubscribe={onSubscribe}
        subscribeHref={subscribeHref}
        subscribersEnabled={subscribersEnabled}
        title={title}
      />

      <section
        aria-live="polite"
        className="flex flex-col items-center gap-3 py-6 text-center"
        data-slot="status-overall"
        data-status={snapshot.overall}
        role="status"
      >
        <StatusDot
          className="scale-150"
          pulse
          status={overallStatusLevel(snapshot.overall)}
        />
        <h1 className="m-0 text-2xl font-semibold text-balance text-heyo-strong sm:text-3xl">
          {overallStatusLabel(snapshot.overall)}
        </h1>
        <p className="m-0 text-sm text-heyo-subtle">
          Updated {formatTimestamp(snapshot.generatedAt)}
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
        {groups.map(({ group, monitors }) => (
          <div className="flex flex-col gap-4" key={group.name}>
            <SectionHeading>{group.name}</SectionHeading>
            <Card className="divide-y divide-heyo-hairline p-0">
              {monitors.map((monitor) => (
                <MonitorRow
                  key={monitor.name}
                  metrics={metrics}
                  monitor={monitor}
                  period={period}
                />
              ))}
            </Card>
          </div>
        ))}
        {ungroupedMonitors.length > 0 ? (
          <div className="flex flex-col gap-4">
            {groups.length > 0 ? <SectionHeading>Other</SectionHeading> : null}
            <Card className="divide-y divide-heyo-hairline p-0">
              {ungroupedMonitors.map((monitor) => (
                <MonitorRow
                  key={monitor.name}
                  metrics={metrics}
                  monitor={monitor}
                  period={period}
                />
              ))}
            </Card>
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

/** Name, live dot and uptime on one line; the history bar underneath it. */
function MonitorRow({
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
    <article
      className="flex flex-col gap-3 px-4 py-4"
      data-slot="status-monitor"
    >
      <div className="flex min-w-0 items-center gap-3">
        {/*
         * The dot alone, not the dot plus its label. A labelled dot in the
         * leading position is as wide as the word it happens to carry, so
         * "Operational", "Outage" and "No data" each started the name at a
         * different x and the column of service names came out ragged. The
         * state is on the dot, the uptime figure on the right says the rest.
         */}
        <StatusDot
          aria-label={currentStatusLabel(monitor.latestStatus)}
          pulse={monitor.latestStatus === true}
          role="img"
          status={currentStatusLevel(monitor.latestStatus)}
        />
        <div className="min-w-0 flex-1">
          <h3 className="m-0 truncate text-sm font-medium text-heyo-strong">
            {monitor.name}
          </h3>
          {monitor.description ? (
            <p className="m-0 truncate text-xs text-heyo-subtle">
              {monitor.description}
            </p>
          ) : null}
        </div>
        {showUptimePercent ? (
          <p className="m-0 shrink-0 text-sm tabular-nums text-heyo-default">
            {formatUptime(uptimeForPeriod(monitor, period))}
            <span className="ml-1 text-xs text-heyo-subtle">{period}</span>
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

export const fernTheme: HeyoStatusTheme = {
  name: "fern",
  Layout: FernLayout,
};
