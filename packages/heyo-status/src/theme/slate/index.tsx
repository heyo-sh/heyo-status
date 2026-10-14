"use client";

import { cn, Empty } from "@heyo-sh/heyo-ui";

import {
  ActiveIncidents,
  MonitorCard,
  MonitorGroup,
  OverallStatus,
  ScheduledMaintenance,
  SectionHeading,
  StatusFooter,
  StatusHeader,
  StatusShell,
} from "../../ui/primitives";
import type { HeyoStatusTheme, StatusLayoutProps } from "../contract";

/**
 * Slate — the default: one card per monitor, grouped services, a ninety-day
 * history bar and a latency sparkline. It is the theme for a page whose job is
 * to answer "how has this been doing?" rather than only "is it up?".
 */
function SlateLayout({
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
  return (
    <StatusShell className={cn("gap-6", className)} theme="slate">
      <StatusHeader
        branding={branding}
        onSubscribe={onSubscribe}
        subscribeHref={subscribeHref}
        subscribersEnabled={subscribersEnabled}
        title={title}
      />
      <OverallStatus status={snapshot.overall} />
      <ActiveIncidents
        incidents={snapshot.activeIncidents}
        now={snapshot.generatedAt}
      />
      <ScheduledMaintenance
        maintenance={snapshot.scheduledMaintenances}
        now={snapshot.generatedAt}
      />
      <section aria-label="Monitors" className="flex flex-col gap-5">
        {groups.map(({ group, monitors }) => (
          <MonitorGroup
            group={group}
            key={group.name}
            metrics={metrics}
            monitors={monitors}
          />
        ))}
        {ungroupedMonitors.length > 0 ? (
          <section className="flex flex-col gap-3">
            <SectionHeading className="px-1">Monitors</SectionHeading>
            <div className="flex flex-col gap-3">
              {ungroupedMonitors.map((monitor) => (
                <MonitorCard
                  key={monitor.name}
                  metrics={metrics}
                  monitor={monitor}
                />
              ))}
            </div>
          </section>
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

export const slateTheme: HeyoStatusTheme = {
  name: "slate",
  Layout: SlateLayout,
};
