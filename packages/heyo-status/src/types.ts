import type { BuiltInStatusThemeName } from "./theme/names";

/** Names of UI themes bundled with Heyo Status. */
export type StatusThemeName = BuiltInStatusThemeName;

/** The initial colour-mode preference for a status page. */
export type StatusMode = "system" | "light" | "dark";

export interface StatusColors {
  primary?: string;
  secondary?: string;
}

export interface StatusBranding {
  /** Optional label shown beside the logo in the page header. */
  name?: string;
  logo?: string;
}

/** Validated branding; the page title never becomes a visible brand name. */
export interface ResolvedStatusBranding {
  name?: string;
  logo?: string;
}

export interface MonitorConfig {
  name: string;
  description?: string;
  /** Optional public group/category, for example "Frontend". */
  group?: string;
  /** Private monitors are checked but omitted from public snapshots. */
  private?: boolean;
}

export interface HttpMonitorConfig extends MonitorConfig {
  type: "http";
  url: string;
  method?: string;
  headers?: Record<string, string>;
  expectedStatus?: number[];
  /** Exact response-header values required for a healthy HTTP result. */
  expectedResponseHeaders?: Record<string, string>;
  timeoutMs?: number;
  softFail?: boolean;
  softFailMs?: number;
  expectedBodyIncludes?: string;
  expectedBodyExcludes?: string;
  expectedJson?: JsonObject;
  followRedirects?: boolean;
}

export interface SslMonitorConfig extends MonitorConfig {
  type: "ssl";
  host: string;
  port?: number;
  warnBeforeDays?: number;
  timeoutMs?: number;
}

export interface TcpMonitorConfig extends MonitorConfig {
  type: "tcp";
  host: string;
  port: number;
  timeoutMs?: number;
}

export interface DnsMonitorConfig extends MonitorConfig {
  type: "dns";
  host: string;
  recordType?: string;
  timeoutMs?: number;
}

/** How a composite monitor derives its status from its component monitors. */
export type CompositeStrategy = "all" | "any" | "majority";

export interface CompositeMonitorConfig extends MonitorConfig {
  type: "composite";
  /** Names of configured non-composite monitors aggregated by this monitor. */
  monitors: string[];
  /** Defaults to `all`: every component must be healthy. */
  strategy?: CompositeStrategy;
}

export type StatusMonitorConfig =
  | HttpMonitorConfig
  | SslMonitorConfig
  | TcpMonitorConfig
  | DnsMonitorConfig
  | CompositeMonitorConfig;

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

/** A single result produced by a configured monitor. */
export interface CheckResult {
  name: string;
  type: StatusMonitorConfig["type"];
  status: boolean;
  message: string;
  latencyMs: number;
  checkedAt: Date;
}

/** Additional diagnostics returned by an HTTP monitor. */
export interface HttpCheckResult extends CheckResult {
  type: "http";
  httpStatus?: number;
  responseHeaders?: Record<string, string>;
  bodyMatch?: boolean;
  jsonMatch?: boolean;
}

/** Additional diagnostics returned by an SSL monitor. */
export interface SslCheckResult extends CheckResult {
  type: "ssl";
  /** Whole days until the peer certificate expires, when it could be read. */
  expiresInDays?: number;
  /**
   * True when the only reason this check failed is an expiry inside
   * `warnBeforeDays`. The notification dispatcher uses it to raise
   * `ssl.expiring` instead of `monitor.down`.
   */
  expiring?: boolean;
}

/**
 * A daily, database-level aggregate. It is intentionally independent of a
 * database dialect so snapshot construction has one input shape everywhere.
 */
export interface DailySummary {
  name: string;
  dayStartAt: Date;
  totalChecks: number;
  downChecks: number;
  downMinutes: number;
  totalLatencyMs: number;
  minLatencyMs: number | null;
  maxLatencyMs: number | null;
  latestStatus: boolean;
  latestCheckedAt: Date;
}

/** Raw history and daily aggregates required to build a public snapshot. */
export interface SnapshotData {
  results: CheckResult[];
  dailySummaries: DailySummary[];
}

/** Outcome of compacting raw check results into daily summaries. */
export interface SummarizeResult {
  summarizedDays: number;
  summarizedResults: number;
  deletedResults: number;
}

export type IncidentStatus =
  "investigating" | "identified" | "monitoring" | "resolved";
export type IncidentSeverity = "minor" | "major" | "critical";

export interface IncidentUpdate {
  id: string;
  status: IncidentStatus;
  message: string;
  createdAt: Date;
  /** An optional severity change made with this timeline entry. */
  severity?: IncidentSeverity;
}

export interface Incident {
  id: string;
  title: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  affectedMonitors: string[];
  /** True when the runtime opened the incident after monitor failures. */
  auto: boolean;
  updates: IncidentUpdate[];
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
}

export interface NewIncident {
  title: string;
  severity: IncidentSeverity;
  affectedMonitors: string[];
  message: string;
  status?: Exclude<IncidentStatus, "resolved">;
  /** Reserved for the monitoring runtime; API and CLI incidents are manual. */
  auto?: boolean;
}

export interface IncidentListOptions {
  status?: IncidentStatus | IncidentStatus[];
  severity?: IncidentSeverity | IncidentSeverity[];
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export type MaintenanceStatus = "scheduled" | "in-progress" | "completed";

export interface Maintenance {
  id: string;
  title: string;
  description: string;
  affectedMonitors: string[];
  scheduledStart: Date;
  scheduledEnd: Date;
  status: MaintenanceStatus;
  createdAt: Date;
}

export interface NewMaintenance {
  title: string;
  description?: string;
  affectedMonitors: string[];
  scheduledStart: Date;
  scheduledEnd: Date;
}

/** A partial edit of a scheduled maintenance window. */
export interface MaintenanceUpdate {
  title?: string;
  description?: string;
  affectedMonitors?: string[];
  scheduledStart?: Date;
  scheduledEnd?: Date;
  status?: MaintenanceStatus;
}

/** A public subscription destination. RSS and Atom are URL-based, not rows. */
export type SubscriberType = "email" | "webhook";

export interface Subscriber {
  id: string;
  type: SubscriberType;
  /** Email address or HTTP(S) webhook URL. Never expose a confirmation token. */
  target: string;
  confirmed: boolean;
  /** `null` means the subscriber wants events for every monitor. */
  monitors: string[] | null;
  createdAt: Date;
}

/** Input accepted by persistence; confirmation fields are runtime-internal. */
export interface NewSubscriber {
  type: SubscriberType;
  target: string;
  monitors?: string[] | null;
  confirmed?: boolean;
  confirmToken?: string | null;
}

export interface SubscriberListOptions {
  type?: SubscriberType;
  confirmed?: boolean;
}

/**
 * The persistence boundary for all supported database implementations. Core
 * code must depend only on this interface, never on a database driver.
 */
export interface StatusDatabaseAdapter {
  insertCheckResults(results: CheckResult[]): Promise<void>;
  getSnapshot(
    monitors: string[],
    displayDays: number,
    now?: Date,
  ): Promise<SnapshotData>;
  summarizeHistory(before: Date): Promise<SummarizeResult>;
  cleanup(retentionDays: number, now?: Date): Promise<void>;

  createIncident(incident: NewIncident): Promise<Incident>;
  updateIncident(id: string, update: IncidentUpdate): Promise<Incident>;
  resolveIncident(id: string, message: string): Promise<Incident>;
  listIncidents(options: IncidentListOptions): Promise<Incident[]>;
  getIncident(id: string): Promise<Incident | null>;
  deleteIncident(id: string): Promise<void>;

  createMaintenance(window: NewMaintenance): Promise<Maintenance>;
  /** Refreshes scheduled/in-progress/completed state before returning active windows. */
  listUpcoming(now?: Date): Promise<Maintenance[]>;
  getMaintenance(id: string): Promise<Maintenance | null>;
  updateMaintenance(
    id: string,
    update: MaintenanceUpdate,
  ): Promise<Maintenance>;
  deleteMaintenance(id: string): Promise<void>;

  createSubscriber(subscriber: NewSubscriber): Promise<Subscriber>;
  /** Confirms an email subscription and consumes its single-use token. */
  confirmSubscriber(confirmToken: string): Promise<Subscriber | null>;
  listSubscribers(options?: SubscriberListOptions): Promise<Subscriber[]>;
  /** Returns false when the opaque public subscription id does not exist. */
  deleteSubscriber(id: string): Promise<boolean>;

  /**
   * Persists a delivery outcome without retaining a channel's credentials or
   * the potentially sensitive full payload.
   */
  recordNotification(
    notification: NewNotificationLog,
  ): Promise<NotificationLog>;
  listNotificationLog(
    options?: NotificationLogOptions,
  ): Promise<NotificationLog[]>;
}

/**
 * An event name accepted by a channel's `events` option. Wildcards select a
 * whole family, so `"incident.*"` follows every incident event added later.
 */
export type StatusEventSelector =
  | StatusEventType
  | "monitor.*"
  | "ssl.*"
  | "incident.*"
  | "maintenance.*"
  | "*";

export type StatusEventType =
  | "monitor.down"
  | "monitor.recovered"
  | "ssl.expiring"
  | "incident.created"
  | "incident.updated"
  | "incident.resolved"
  | "maintenance.scheduled"
  | "maintenance.starting"
  | "maintenance.completed";

export interface NotificationMonitor extends CheckResult {
  /** Public group from the matching monitor configuration, when present. */
  group?: string;
  /** The checked URL or host:port, retained for notification detail only. */
  target?: string;
  /** Failure count at the moment this event was emitted. */
  consecutiveFailures?: number;
}

export interface StatusEventPage {
  title: string;
  siteUrl?: string;
}

/** A framework-neutral event delivered to notification channels. */
export interface StatusEvent {
  type: StatusEventType;
  occurredAt: Date;
  monitor?: NotificationMonitor;
  incident?: Incident;
  maintenance?: Maintenance;
  /** Added by the dispatcher so channels can link back to the status page. */
  page?: StatusEventPage;
}

export type NotificationChannelType = "slack" | "discord" | "webhook" | "email";
export type NotificationDeliveryStatus = "sent" | "failed";

/** Optional metadata returned by a channel after it has attempted delivery. */
export interface NotificationDeliveryResult {
  /** Number of HTTP/provider attempts made for this one delivery. */
  attempts?: number;
}

export interface NotificationLog {
  id: string;
  channelId: string;
  channelType: NotificationChannelType;
  eventType: StatusEventType;
  status: NotificationDeliveryStatus;
  attempts: number;
  error: string | null;
  monitorName: string | null;
  incidentId: string | null;
  maintenanceId: string | null;
  createdAt: Date;
}

export interface NewNotificationLog {
  channelId: string;
  channelType: NotificationChannelType;
  eventType: StatusEventType;
  status: NotificationDeliveryStatus;
  attempts?: number;
  error?: string | null;
  monitorName?: string;
  incidentId?: string;
  maintenanceId?: string;
  createdAt?: Date;
}

export interface NotificationLogOptions {
  channelId?: string;
  eventType?: StatusEventType | StatusEventType[];
  status?: NotificationDeliveryStatus | NotificationDeliveryStatus[];
  limit?: number;
  offset?: number;
}

export interface SubscriberEmailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
}

export interface NotificationChannel {
  id: string;
  type: NotificationChannelType;
  /** If omitted, the channel receives every event in the event catalogue. */
  events?: readonly StatusEventType[];
  send(event: StatusEvent): Promise<void | NotificationDeliveryResult>;
  /**
   * Email channels can expose their configured transport for public
   * subscription confirmation and incident mail. Other channel types omit it.
   */
  sendEmail?(
    message: SubscriberEmailMessage,
  ): Promise<void | NotificationDeliveryResult>;
}

export interface StatusChecksConfig {
  interval: string;
  retentionDays: number;
  displayDays: number;
  summaryCron: string;
  cleanupCron: string;
}

export interface StatusNotificationsConfig {
  failureThreshold: number;
  channels: NotificationChannel[];
}

export interface StatusIncidentsConfig {
  enabled: boolean;
}

export interface StatusMaintenanceConfig {
  enabled: boolean;
}

export type UptimePeriod = "24h" | "7d" | "30d" | "90d";

export interface StatusMetricsConfig {
  showLatency: boolean;
  /** Renders the latency sparkline on monitor cards. */
  showLatencyChart: boolean;
  showUptimePercent: boolean;
  uptimePeriods: UptimePeriod[];
  /** Serves embeddable SVG badges from `/api/badge/:monitor.svg`. */
  badges: boolean;
  /** Serves an OpenMetrics-compatible exposition from `/api/metrics`. */
  prometheus: boolean;
}

export interface StatusCacheConfig {
  /** In-memory snapshot lifetime. `0` disables caching entirely. */
  snapshotTtlMs: number;
}

export type SubscriberMethod = "email" | "rss" | "webhook";

export interface StatusSubscribersConfig {
  enabled: boolean;
  methods: SubscriberMethod[];
  requireConfirmation: boolean;
}

/** Fully validated and normalised configuration consumed by the runtime. */
export interface StatusPageConfig {
  database: StatusDatabaseAdapter;
  title: string;
  description: string;
  siteUrl?: string;
  /**
   * Path prefix the framework catch-all route is mounted at. It is stripped
   * before routing, so every endpoint is reachable at `basePath + path`.
   */
  basePath: string;
  /**
   * Bearer token required by `/admin/*`. When omitted, management requests
   * are refused.
   */
  adminToken?: string;
  /** Bearer secret for Vercel cron routes. Omit to keep the routes closed. */
  cronSecret?: string;
  theme: StatusThemeName;
  colors: StatusColors;
  mode: StatusMode;
  branding: ResolvedStatusBranding;
  monitors: StatusMonitorConfig[];
  checks: StatusChecksConfig;
  notifications: StatusNotificationsConfig;
  incidents: StatusIncidentsConfig;
  maintenance: StatusMaintenanceConfig;
  metrics: StatusMetricsConfig;
  subscribers: StatusSubscribersConfig;
  cache: StatusCacheConfig;
}

/** Input accepted by {@link heyoStatus} before defaults are applied. */
export interface UserStatusPageConfig {
  database: StatusDatabaseAdapter;
  title?: string;
  description?: string;
  siteUrl?: string;
  basePath?: string;
  adminToken?: string;
  cronSecret?: string;
  theme?: StatusThemeName;
  colors?: StatusColors;
  mode?: StatusMode;
  branding?: StatusBranding;
  monitors?: StatusMonitorConfig[];
  checks?: Partial<StatusChecksConfig>;
  notifications?: Partial<StatusNotificationsConfig>;
  incidents?: Partial<StatusIncidentsConfig>;
  maintenance?: Partial<StatusMaintenanceConfig>;
  metrics?: Partial<StatusMetricsConfig>;
  subscribers?: Partial<StatusSubscribersConfig>;
  cache?: Partial<StatusCacheConfig>;
}

export type OverallStatus =
  "operational" | "degraded" | "major-outage" | "maintenance";
export type MonitorGroupStatus = "operational" | "degraded" | "outage";

export interface MonitorGroup {
  name: string;
  status: MonitorGroupStatus;
  monitors: string[];
}

export interface DaySnapshot {
  key: string;
  label: string;
  status: "up" | "down" | "degraded" | "empty";
  tooltip: string;
  totalChecks: number;
  downChecks: number;
  downMinutes: number;
  downPercent: number;
}

/** One latency bucket of a monitor's sparkline series, oldest entry first. */
export interface LatencySample {
  /** Stable bucket identifier, also usable as a React key. */
  key: string;
  /** Pre-formatted UTC label so server and client markup always agree. */
  label: string;
  at: Date;
  latencyMs: number;
  totalChecks: number;
}

export interface MonitorSnapshot {
  name: string;
  type: StatusMonitorConfig["type"];
  description?: string;
  group?: string;
  latestStatus: boolean | null;
  latestCheckedAt: Date | null;
  latestLatencyMs: number | null;
  /** Uptime across the whole displayed window, which is `checks.displayDays`. */
  uptimePercent: number | null;
  uptimePercent24h: number | null;
  uptimePercent7d: number | null;
  uptimePercent30d: number | null;
  /** Bounded by `checks.displayDays`; no history exists outside that window. */
  uptimePercent90d: number | null;
  avgLatencyMs: number | null;
  days: DaySnapshot[];
  /** Hourly buckets for the last 24h, or daily averages when history is compacted. */
  latencySeries: LatencySample[];
}

/** Public, framework-independent payload supplied to a status-page frontend. */
export interface StatusSnapshot {
  generatedAt: Date;
  retentionDays: number;
  displayDays: number;
  overall: OverallStatus;
  groups: MonitorGroup[];
  monitors: MonitorSnapshot[];
  activeIncidents: Incident[];
  /** Upcoming and in-progress windows; completed ones are never published. */
  scheduledMaintenances: Maintenance[];
  hasConfig: boolean;
  hasData: boolean;
}

/** Programmatic status-read surface exposed by {@link heyoStatus}. */
export interface StatusPageApi {
  getSnapshot(now?: Date): Promise<StatusSnapshot>;
  listMonitors(now?: Date): Promise<MonitorSnapshot[]>;
  getMonitor(name: string, now?: Date): Promise<MonitorSnapshot | null>;
  /** Drops the cached snapshot after an out-of-band database write. */
  invalidate(): void;
}

/** Scheduler-friendly operations which do not require HTTP routing. */
export interface StatusPageCron {
  runChecks(now?: Date): Promise<CheckResult[]>;
  summarize(now?: Date): Promise<SummarizeResult>;
  cleanup(now?: Date): Promise<void>;
}

/**
 * A validated status configuration with its framework-neutral Hono handler and
 * operational helpers attached as non-enumerable runtime properties.
 */
export interface StatusPage extends StatusPageConfig {
  handler(request: Request): Promise<Response>;
  api: StatusPageApi;
  cron: StatusPageCron;
}
