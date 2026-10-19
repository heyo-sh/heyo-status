"use client";

import { Badge, Card, cn, Empty, StatusDot } from "@heyo-sh/heyo-ui";

import type { Incident, MonitorSnapshot } from "../../types";
import { uptimeForPeriod } from "../../uptime";
import {
  currentStatusLabel,
  currentStatusLevel,
  formatAffectedMonitors,
  formatDate,
  formatTimestamp,
  formatUptime,
  IncidentTimeline,
  incidentStatusLabel,
  incidentStatusVariant,
  machineTimestamp,
  ScheduledMaintenance,
  SectionHeading,
  severityVariant,
  StatusBanner,
  StatusFooter,
  StatusHeader,
  StatusShell,
  type StatusMetricsOptions,
} from "../../ui/primitives";
import type { HeyoStatusTheme, StatusLayoutProps } from "../contract";

/**
 * Onyx — a global verdict, a flat list of components, then the incident
 * history as a dated timeline.
 *
 * Incidents are the subject of this theme rather than a section near the
 * bottom: the page is built for the day something broke and someone needs the
 * narrative, not the uptime arithmetic.
 */
function OnyxLayout({
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
  const hasIncidents = snapshot.activeIncidents.length > 0;

  return (
    <StatusShell className={cn("gap-8", className)} theme="onyx">
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

      <section aria-label="Monitors" className="flex flex-col gap-3">
        <SectionHeading>Components</SectionHeading>
        <Card className="divide-y divide-heyo-hairline">
          {groups.map(({ group, monitors }) => (
            <div key={group.name}>
              <p className="m-0 bg-heyo-recessed px-4 py-2 text-xs font-medium tracking-wide text-heyo-subtle uppercase">
                {group.name}
              </p>
              <div className="divide-y divide-heyo-hairline">
                {monitors.map((monitor) => (
                  <ComponentRow
                    key={monitor.name}
                    metrics={metrics}
                    monitor={monitor}
                  />
                ))}
              </div>
            </div>
          ))}
          {ungroupedMonitors.map((monitor) => (
            <ComponentRow
              key={monitor.name}
              metrics={metrics}
              monitor={monitor}
            />
          ))}
        </Card>
        {!snapshot.hasConfig ? (
          <Empty
            bordered
            description="Add a monitor to start publishing uptime history."
            title="No monitors configured"
          />
        ) : null}
      </section>

      <ScheduledMaintenance
        enabled={maintenanceEnabled}
        maintenance={snapshot.scheduledMaintenances}
        now={snapshot.generatedAt}
      />

      {incidentsEnabled ? (
        <section
          aria-labelledby="heyo-incident-history-heading"
          className="flex flex-col gap-3"
        >
          <SectionHeading id="heyo-incident-history-heading">
            Active incidents
          </SectionHeading>
          {hasIncidents ? (
            <div className="flex flex-col gap-6">
              {snapshot.activeIncidents.map((incident) => (
                <IncidentEntry incident={incident} key={incident.id} />
              ))}
            </div>
          ) : (
            <Card className="px-4 py-3 text-sm text-heyo-subtle">
              No active incidents.
            </Card>
          )}
        </section>
      ) : null}

      <StatusFooter
        className="mt-auto"
        generatedAt={snapshot.generatedAt}
        rssHref={rssHref}
        showPoweredBy={showPoweredBy}
      />
    </StatusShell>
  );
}

/** One component: what it is on the left, what it is doing on the right. */
function ComponentRow({
  monitor,
  metrics,
}: {
  monitor: MonitorSnapshot;
  metrics?: StatusMetricsOptions;
}) {
  const showUptimePercent = metrics?.showUptimePercent ?? true;

  return (
    <div
      className="flex min-w-0 items-center gap-3 px-4 py-3"
      data-slot="status-monitor"
    >
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
        <span className="shrink-0 text-xs tabular-nums text-heyo-subtle">
          {formatUptime(uptimeForPeriod(monitor, "90d"))}
        </span>
      ) : null}
      <StatusDot
        className="shrink-0"
        label={currentStatusLabel(monitor.latestStatus)}
        status={currentStatusLevel(monitor.latestStatus)}
      />
    </div>
  );
}

/** A dated incident with its updates, the way a post-mortem reads. */
function IncidentEntry({ incident }: { incident: Incident }) {
  return (
    // The RSS/Atom feeds link to `#incident-<id>`, so the anchor has to exist
    // in the rendered page for those links to resolve.
    <article
      className="flex flex-col gap-3 border-l-2 border-heyo-line pl-4"
      id={`incident-${incident.id}`}
    >
      <p className="m-0 text-xs tracking-wide text-heyo-subtle uppercase">
        <time dateTime={machineTimestamp(incident.createdAt)}>
          {formatDate(incident.createdAt)}
        </time>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 min-w-0 flex-1 text-base font-medium text-heyo-strong">
          {incident.title}
        </h3>
        <Badge dot variant={incidentStatusVariant(incident.status)}>
          {incidentStatusLabel(incident.status)}
        </Badge>
        <Badge size="sm" variant={severityVariant(incident.severity)}>
          {incident.severity}
        </Badge>
      </div>
      <p className="m-0 text-xs text-heyo-subtle">
        Affected: {formatAffectedMonitors(incident.affectedMonitors)}
      </p>
      <IncidentTimeline updates={incident.updates} />
    </article>
  );
}

export const onyxTheme: HeyoStatusTheme = {
  name: "onyx",
  Layout: OnyxLayout,
};
