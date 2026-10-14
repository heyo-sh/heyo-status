"use client";

import {
  Badge,
  Button,
  Card,
  CardBody,
  cardVariants,
  CardHeader,
  cn,
  Meter,
  Separator,
  StatusDot,
  Timeline,
  type StatusLevel,
} from "@heyo-sh/heyo-ui";
import type { MouseEventHandler, ReactNode } from "react";

import { useStatusTheme } from "../theme/provider";
import type {
  Incident,
  Maintenance,
  MonitorGroup as MonitorGroupData,
  MonitorSnapshot,
  OverallStatus as OverallStatusValue,
  ResolvedStatusBranding,
  StatusMetricsConfig,
  StatusThemeName,
} from "../types";
import { uptimeForPeriod } from "../uptime";
import { DayGrid } from "./day-grid";
import { LatencyChart } from "./latency-chart";

/** The presentation-only subset of metrics configuration used by the UI. */
export type StatusMetricsOptions = Partial<
  Pick<
    StatusMetricsConfig,
    "showLatency" | "showLatencyChart" | "showUptimePercent" | "uptimePeriods"
  >
>;

export interface StatusShellProps {
  /** Published as `data-theme`, so a project can style one theme only. */
  theme: StatusThemeName;
  children: ReactNode;
  className?: string;
}

/**
 * The page container every theme renders into.
 *
 * It carries the stable `data-slot="status-page"` hook and the max-width token
 * each theme stylesheet sets, so themes differ in composition rather than in
 * how an embedding application targets them.
 *
 * `min-h-screen` rather than `min-h-full` because the host application is not
 * required to give `html`/`body` a height, and without one a percentage
 * minimum resolves to nothing — which left the footer floating mid-page on a
 * status page with only a couple of monitors. The viewport unit needs no
 * cooperation from the embedding document, and the footer's `mt-auto` then
 * has the free space it needs to push itself to the bottom.
 */
export function StatusShell({ theme, children, className }: StatusShellProps) {
  return (
    <main
      className={cn(
        "mx-auto flex min-h-screen w-full max-w-(--status-page-max-width) flex-col p-4 sm:p-6",
        className,
      )}
      // Every heyo-ui component exposes a stable `data-slot`, so an embedding
      // application can restyle the page without a variant API and without
      // depending on a class name that is generated.
      data-slot="status-page"
      data-theme={theme}
    >
      {children}
    </main>
  );
}

export interface StatusHeaderProps {
  branding: ResolvedStatusBranding;
  title?: string;
  subscribersEnabled?: boolean;
  subscribeHref?: string;
  onSubscribe?: MouseEventHandler<HTMLButtonElement>;
  className?: string;
}

/** Header chrome shared by all built-in layouts. */
export function StatusHeader({
  branding,
  title,
  subscribersEnabled = false,
  subscribeHref,
  onSubscribe,
  className,
}: StatusHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-center justify-between gap-3",
        className,
      )}
      data-slot="status-header"
    >
      {branding.logo || branding.name ? (
        <div className="flex min-w-0 items-center gap-3">
          {branding.logo ? (
            <img
              alt={branding.name ? "" : (title ?? "Status page")}
              className="size-8 shrink-0 object-contain"
              data-slot="status-logo"
              src={branding.logo}
            />
          ) : null}
          {branding.name ? (
            <p className="m-0 truncate text-sm font-medium text-heyo-strong">
              {branding.name}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="flex shrink-0 items-center gap-2">
        {subscribersEnabled ? (
          subscribeHref ? (
            <Button
              // A link, not a button: Base UI only keeps native button
              // semantics when it really renders a <button>.
              nativeButton={false}
              render={<a href={subscribeHref} />}
              size="sm"
              variant="primary"
            >
              Subscribe
            </Button>
          ) : (
            <Button onClick={onSubscribe} size="sm" variant="primary">
              Subscribe
            </Button>
          )
        ) : null}
        <DarkModeToggle />
      </div>
    </header>
  );
}

export interface OverallStatusProps {
  status: OverallStatusValue;
  className?: string;
}

/** Announced, high-level health state with a live indicator. */
export function OverallStatus({ status, className }: OverallStatusProps) {
  return (
    <Card
      aria-live="polite"
      className={cn("flex-row items-center gap-3 px-4 py-3.5", className)}
      data-slot="status-overall"
      data-status={status}
      role="status"
    >
      <StatusDot pulse status={overallStatusLevel(status)} />
      <div className="min-w-0">
        <p className="m-0 text-base font-medium text-heyo-strong">
          {overallStatusLabel(status)}
        </p>
        <p className="m-0 text-sm text-heyo-subtle">
          {overallStatusDescription(status)}
        </p>
      </div>
    </Card>
  );
}

export interface StatusBannerProps {
  status: OverallStatusValue;
  /** Right-hand caption, usually the time the snapshot was generated. */
  caption?: ReactNode;
  className?: string;
}

/**
 * The same announcement as {@link OverallStatus}, drawn as a tinted banner.
 * Themes that lead with one global verdict use this instead of a card.
 */
export function StatusBanner({
  status,
  caption,
  className,
}: StatusBannerProps) {
  return (
    <div
      aria-live="polite"
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-xl border px-4 py-4",
        overallStatusBannerTone(status),
        className,
      )}
      data-slot="status-overall"
      data-status={status}
      role="status"
    >
      <StatusDot pulse status={overallStatusLevel(status)} />
      <p className="m-0 min-w-0 flex-1 text-base font-medium text-heyo-strong">
        {overallStatusLabel(status)}
      </p>
      {caption ? (
        <p className="m-0 text-xs tabular-nums text-heyo-subtle">{caption}</p>
      ) : null}
    </div>
  );
}

export interface MonitorGroupProps {
  group: MonitorGroupData;
  monitors: MonitorSnapshot[];
  metrics?: StatusMetricsOptions;
  defaultOpen?: boolean;
  className?: string;
}

/**
 * A native-details disclosure rather than heyo-ui's `Accordion`: a status page
 * is the one page that has to stay readable when the JavaScript bundle fails,
 * which is exactly when people come looking for it.
 */
export function MonitorGroup({
  group,
  monitors,
  metrics,
  defaultOpen = true,
  className,
}: MonitorGroupProps) {
  return (
    <details
      className={cn("group/disclosure", className)}
      data-slot="status-monitor-group"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-1 py-1.5 text-sm font-medium text-heyo-strong hover:bg-heyo-tint [&::-webkit-details-marker]:hidden">
        <ChevronIcon className="size-3.5 shrink-0 text-heyo-subtle transition-transform duration-100 group-open/disclosure:rotate-90" />
        <span className="min-w-0 truncate">{group.name}</span>
        <Badge dot variant={monitorStatusVariant(group.status)}>
          {monitorStatusLabel(group.status)}
        </Badge>
      </summary>
      <div className="mt-2 flex flex-col gap-3">
        {monitors.map((monitor) => (
          <MonitorCard key={monitor.name} metrics={metrics} monitor={monitor} />
        ))}
      </div>
    </details>
  );
}

export interface MonitorCardProps {
  monitor: MonitorSnapshot;
  metrics?: StatusMetricsOptions;
  className?: string;
}

/** A monitor summary, its daily history, and configurable uptime periods. */
export function MonitorCard({ monitor, metrics, className }: MonitorCardProps) {
  const showLatency = metrics?.showLatency ?? true;
  const showLatencyChart = metrics?.showLatencyChart ?? true;
  const showUptimePercent = metrics?.showUptimePercent ?? true;
  const periods = metrics?.uptimePeriods ?? ["24h", "7d", "30d", "90d"];

  return (
    <article
      className={cn(cardVariants(), className)}
      data-slot="status-monitor"
    >
      <CardHeader className="items-start">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="m-0 truncate text-sm leading-5 font-medium text-heyo-strong">
              {monitor.name}
            </h3>
            <Badge size="sm" variant="outline">
              {monitor.type.toUpperCase()}
            </Badge>
          </div>
          {monitor.description ? (
            <p className="m-0 mt-0.5 text-xs text-heyo-subtle">
              {monitor.description}
            </p>
          ) : null}
        </div>
        <StatusDot
          className="shrink-0"
          label={currentStatusLabel(monitor.latestStatus)}
          status={currentStatusLevel(monitor.latestStatus)}
        />
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        <DayGrid days={monitor.days} monitorName={monitor.name} />
        {showLatencyChart ? (
          <LatencyChart
            monitorName={monitor.name}
            samples={monitor.latencySeries}
          />
        ) : null}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-4 gap-y-3">
          {showUptimePercent
            ? periods.map((period) => (
                <UptimeBar
                  key={period}
                  label={period}
                  uptime={uptimeForPeriod(monitor, period)}
                />
              ))
            : null}
          {showLatency ? (
            <Metric
              label="Avg. latency"
              value={formatLatency(monitor.avgLatencyMs)}
            />
          ) : null}
          <Metric
            label="Current status"
            value={currentStatusLabel(monitor.latestStatus)}
          />
        </div>
      </CardBody>
    </article>
  );
}

export interface UptimeBarProps {
  label: string;
  uptime: number | null;
  className?: string;
}

/** A labelled meter which never reports unknown history as 0% uptime. */
export function UptimeBar({ label, uptime, className }: UptimeBarProps) {
  const value = uptime === null ? null : clampPercent(uptime);
  const displayValue = value === null ? "No data" : formatPercent(value);

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-heyo-subtle">{label}</span>
        <span className="tabular-nums text-heyo-default">{displayValue}</span>
      </div>
      {value === null ? (
        // A meter would have to publish `aria-valuenow`, and announcing 0% for
        // history that was never measured is worse than publishing nothing.
        <div aria-hidden className="h-1.5 w-full rounded-full bg-heyo-fill" />
      ) : (
        <Meter
          aria-label={`${label} uptime: ${displayValue}`}
          getAriaValueText={() => displayValue}
          tone={uptimeTone(value)}
          value={value}
        />
      )}
    </div>
  );
}

export interface ActiveIncidentsProps {
  incidents: Incident[];
  now?: Date | string;
  className?: string;
}

/** Active incidents are native disclosures, so their timelines work without JS. */
export function ActiveIncidents({
  incidents,
  now = new Date(),
  className,
}: ActiveIncidentsProps) {
  if (incidents.length === 0) return null;

  return (
    <section
      aria-labelledby="heyo-active-incidents-heading"
      className={cn("flex flex-col gap-3", className)}
    >
      <SectionHeading id="heyo-active-incidents-heading">
        Active incidents
      </SectionHeading>
      <div className="flex flex-col gap-3">
        {incidents.map((incident) => (
          <IncidentDisclosure incident={incident} key={incident.id} now={now} />
        ))}
      </div>
    </section>
  );
}

export interface IncidentDisclosureProps {
  incident: Incident;
  now?: Date | string;
  defaultOpen?: boolean;
  className?: string;
}

/** One incident with its timeline, anchored for the RSS and Atom feeds. */
export function IncidentDisclosure({
  incident,
  now = new Date(),
  defaultOpen = true,
  className,
}: IncidentDisclosureProps) {
  return (
    // The RSS/Atom feeds link to `#incident-<id>`, so the anchor has to exist
    // in the rendered page for those links to resolve.
    <details
      className={cn(cardVariants(), className)}
      id={`incident-${incident.id}`}
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 truncate font-medium text-heyo-strong">
          {incident.title}
        </span>
        <Badge dot variant={incidentStatusVariant(incident.status)}>
          {incidentStatusLabel(incident.status)}
        </Badge>
        <Badge size="sm" variant={severityVariant(incident.severity)}>
          {incident.severity}
        </Badge>
        <span className="shrink-0 text-xs tabular-nums text-heyo-subtle">
          {formatDuration(incident.createdAt, now)}
        </span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-heyo-hairline px-4 py-3.5">
        <p className="m-0 text-xs text-heyo-subtle">
          Affected: {formatAffectedMonitors(incident.affectedMonitors)}
        </p>
        <IncidentTimeline updates={incident.updates} />
      </div>
    </details>
  );
}

export interface IncidentTimelineProps {
  updates: Incident["updates"];
  className?: string;
}

/** A chronological incident update timeline with semantic status labels. */
export function IncidentTimeline({
  updates,
  className,
}: IncidentTimelineProps) {
  if (updates.length === 0) return null;
  const chronological = [...updates].sort(
    (left, right) => timestampOf(left.createdAt) - timestampOf(right.createdAt),
  );
  const latest = chronological.at(-1);

  return (
    <Timeline className={className}>
      {chronological.map((update) => (
        <Timeline.Item
          active={update === latest && update.status !== "resolved"}
          key={update.id}
          time={
            <time dateTime={machineTimestamp(update.createdAt)}>
              {formatTimestamp(update.createdAt)}
            </time>
          }
          title={incidentStatusLabel(update.status)}
          tone={incidentStatusTone(update.status)}
        >
          {update.message}
        </Timeline.Item>
      ))}
    </Timeline>
  );
}

export interface ScheduledMaintenanceProps {
  maintenance: Maintenance[];
  now?: Date | string;
  className?: string;
}

/** Upcoming and in-progress maintenance windows with an SSR-safe countdown. */
export function ScheduledMaintenance({
  maintenance,
  now = new Date(),
  className,
}: ScheduledMaintenanceProps) {
  const windows = maintenance.filter((window) => window.status !== "completed");
  if (windows.length === 0) return null;

  return (
    <section
      aria-labelledby="heyo-scheduled-maintenance-heading"
      className={cn("flex flex-col gap-3", className)}
    >
      <SectionHeading id="heyo-scheduled-maintenance-heading">
        Upcoming maintenance
      </SectionHeading>
      <div className="flex flex-col gap-3">
        {windows.map((window) => (
          <article className={cardVariants()} key={window.id}>
            <CardHeader>
              <h3 className="m-0 min-w-0 truncate text-sm leading-5 font-medium text-heyo-strong">
                {window.title}
              </h3>
              <Badge
                dot
                variant={window.status === "in-progress" ? "info" : "neutral"}
              >
                {window.status === "in-progress" ? "In progress" : "Scheduled"}
              </Badge>
            </CardHeader>
            <CardBody className="flex flex-col gap-2">
              {window.description ? (
                <p className="m-0 text-sm text-heyo-subtle">
                  {window.description}
                </p>
              ) : null}
              <p className="m-0 text-sm tabular-nums text-heyo-default">
                <time dateTime={machineTimestamp(window.scheduledStart)}>
                  {formatTimestamp(window.scheduledStart)}
                </time>
                <span aria-hidden="true"> – </span>
                <time dateTime={machineTimestamp(window.scheduledEnd)}>
                  {formatTimestamp(window.scheduledEnd)}
                </time>
              </p>
              <p className="m-0 text-xs text-heyo-subtle">
                Affected: {formatAffectedMonitors(window.affectedMonitors)} ·{" "}
                {formatMaintenanceCountdown(window, now)}
              </p>
            </CardBody>
          </article>
        ))}
      </div>
    </section>
  );
}

export interface StatusFooterProps {
  /** Accepts an ISO timestamp too, so a JSON API snapshot can be rendered directly. */
  generatedAt: Date | string;
  rssHref?: string;
  showPoweredBy?: boolean;
  className?: string;
}

export function StatusFooter({
  generatedAt,
  rssHref,
  showPoweredBy = true,
  className,
}: StatusFooterProps) {
  return (
    <footer
      className={cn("flex flex-col gap-3", className)}
      data-slot="status-footer"
    >
      <Separator />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-heyo-subtle">
        <span>Last updated {formatTimestamp(generatedAt)}</span>
        {rssHref ? (
          <a className="text-heyo-link hover:underline" href={rssHref}>
            RSS
          </a>
        ) : null}
        {showPoweredBy ? (
          <a
            className="ml-auto text-heyo-link hover:underline"
            href="https://heyo.sh"
            rel="noreferrer"
            target="_blank"
          >
            Powered by heyo
          </a>
        ) : null}
      </div>
    </footer>
  );
}

export interface DarkModeToggleProps {
  className?: string;
}

/** Switches the persisted preference between the currently resolved palettes. */
export function DarkModeToggle({ className }: DarkModeToggleProps) {
  const { resolvedTheme, toggleTheme } = useStatusTheme();
  const nextTheme = resolvedTheme === "dark" ? "light" : "dark";

  return (
    <Button
      aria-label={`Switch to ${nextTheme} mode`}
      className={className}
      onClick={toggleTheme}
      shape="square"
      size="sm"
      title={`Switch to ${nextTheme} mode`}
      variant="ghost"
    >
      {resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}

/** The quiet, uppercase section label every built-in theme shares. */
export function SectionHeading({
  children,
  id,
  className,
}: {
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        "m-0 text-xs font-medium tracking-wider text-heyo-subtle uppercase",
        className,
      )}
      id={id}
    >
      {children}
    </h2>
  );
}

export function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-xs">
      <span className="text-heyo-subtle">{label}</span>
      <span className="truncate font-medium tabular-nums text-heyo-default">
        {value}
      </span>
    </div>
  );
}

export type BadgeVariant =
  "neutral" | "outline" | "info" | "success" | "warning" | "danger";

export function incidentStatusLabel(status: Incident["status"]): string {
  switch (status) {
    case "investigating":
      return "Investigating";
    case "identified":
      return "Identified";
    case "monitoring":
      return "Monitoring";
    case "resolved":
      return "Resolved";
  }
}

export function incidentStatusVariant(
  status: Incident["status"],
): BadgeVariant {
  switch (status) {
    case "investigating":
      return "danger";
    case "identified":
      return "warning";
    case "monitoring":
      return "info";
    case "resolved":
      return "success";
  }
}

export function incidentStatusTone(
  status: Incident["status"],
): "info" | "success" | "warning" | "danger" {
  const variant = incidentStatusVariant(status);
  return variant === "neutral" || variant === "outline" ? "info" : variant;
}

export function severityVariant(severity: Incident["severity"]): BadgeVariant {
  switch (severity) {
    case "minor":
      return "outline";
    case "major":
      return "warning";
    case "critical":
      return "danger";
  }
}

export function monitorStatusLabel(status: MonitorGroupData["status"]): string {
  switch (status) {
    case "operational":
      return "Operational";
    case "degraded":
      return "Degraded";
    case "outage":
      return "Outage";
  }
}

export function monitorStatusVariant(
  status: MonitorGroupData["status"],
): BadgeVariant {
  switch (status) {
    case "operational":
      return "success";
    case "degraded":
      return "warning";
    case "outage":
      return "danger";
  }
}

export function overallStatusLevel(status: OverallStatusValue): StatusLevel {
  switch (status) {
    case "operational":
      return "operational";
    case "degraded":
      return "degraded";
    case "major-outage":
      return "down";
    case "maintenance":
      return "maintenance";
  }
}

export function overallStatusLabel(status: OverallStatusValue): string {
  switch (status) {
    case "operational":
      return "All Systems Operational";
    case "degraded":
      return "Partial System Outage";
    case "major-outage":
      return "Major System Outage";
    case "maintenance":
      return "Under Maintenance";
  }
}

export function overallStatusDescription(status: OverallStatusValue): string {
  switch (status) {
    case "operational":
      return "All monitored services are operating normally.";
    case "degraded":
      return "Some monitored services are experiencing reduced availability.";
    case "major-outage":
      return "Multiple monitored services are currently unavailable.";
    case "maintenance":
      return "Scheduled maintenance is currently in progress.";
  }
}

/** Border and surface classes a banner uses for one overall state. */
function overallStatusBannerTone(status: OverallStatusValue): string {
  switch (status) {
    case "operational":
      return "border-heyo-success/30 bg-heyo-success/8";
    case "degraded":
      return "border-heyo-warning/30 bg-heyo-warning/8";
    case "major-outage":
      return "border-heyo-danger/30 bg-heyo-danger/8";
    case "maintenance":
      return "border-heyo-info/30 bg-heyo-info/8";
  }
}

export function currentStatusLabel(status: boolean | null): string {
  return status === null ? "No data" : status ? "Operational" : "Outage";
}

export function currentStatusLevel(status: boolean | null): StatusLevel {
  return status === null ? "unknown" : status ? "operational" : "down";
}

export function currentStatusVariant(status: boolean | null): BadgeVariant {
  return status === null ? "neutral" : status ? "success" : "danger";
}

export function uptimeTone(value: number): "success" | "warning" | "danger" {
  if (value >= 99.9) return "success";
  if (value >= 95) return "warning";
  return "danger";
}

export function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export function formatPercent(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(2)}%`;
}

/** Formats an uptime percentage, or says so when nothing was ever measured. */
export function formatUptime(value: number | null): string {
  return value === null ? "No data" : formatPercent(clampPercent(value));
}

export function formatLatency(value: number | null): string {
  return value === null ? "No data" : `${Math.round(value)} ms`;
}

export function formatAffectedMonitors(monitors: string[]): string {
  return monitors.length === 0 ? "All monitors" : monitors.join(", ");
}

export function formatDuration(
  from: Date | string,
  now: Date | string,
): string {
  const start = new Date(from).getTime();
  const end = new Date(now).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return "Just now";
  }
  const minutes = Math.floor((end - start) / 60_000);
  if (minutes < 60) return `${minutes}m ongoing`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ongoing`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h ongoing`;
}

export function formatMaintenanceCountdown(
  maintenance: Maintenance,
  now: Date | string,
): string {
  if (maintenance.status === "in-progress") return "In progress";
  const remaining =
    new Date(maintenance.scheduledStart).getTime() - new Date(now).getTime();
  if (!Number.isFinite(remaining) || remaining <= 0) return "Starting now";
  const minutes = Math.ceil(remaining / 60_000);
  if (minutes < 60) return `Starts in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `Starts in ${hours}h`;
  return `Starts in ${Math.floor(hours / 24)}d`;
}

/**
 * Timestamps arrive as `Date` from `statusPage.api` and as ISO strings from the
 * JSON status API, so every reader normalises instead of assuming a `Date`.
 */
function timestampOf(value: Date | string): number {
  return (value instanceof Date ? value : new Date(value)).getTime();
}

/** Machine-readable `datetime` attribute, omitted when a value is unusable. */
export function machineTimestamp(value: Date | string): string | undefined {
  const time = timestampOf(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

/** Uses UTC so server and client produce identical markup during hydration. */
export function formatTimestamp(value: Date | string): string {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return "Unknown";
  return (
    new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      month: "short",
      timeZone: "UTC",
      year: "numeric",
    }).format(timestamp) + " UTC"
  );
}

/** Day and month only: incident history reads as a date, not a timestamp. */
export function formatDate(value: Date | string): string {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(timestamp);
}

export function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
    >
      <path d="M20.4 15.5A8.5 8.5 0 0 1 8.5 3.6 8.5 8.5 0 1 0 20.4 15.5Z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}
