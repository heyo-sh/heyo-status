import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/** Raw monitor observations. They are compacted into daily summaries over time. */
export const statusResults = sqliteTable(
  "status_results",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    // A name can be repurposed in config. Persisting the type keeps historical
    // CheckResult values self-contained for the adapter contract.
    type: text("type").notNull(),
    status: integer("status", { mode: "boolean" }).notNull(),
    latencyMs: integer("latency_ms").notNull().default(0),
    message: text("message"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("idx_status_results_name_created").on(table.name, table.createdAt),
  ],
);

/** Compact per-day aggregates retained after raw observations are removed. */
export const statusDailySummaries = sqliteTable(
  "status_daily_summaries",
  {
    name: text("name").notNull(),
    dayStartAt: integer("day_start_at", { mode: "timestamp_ms" }).notNull(),
    totalChecks: integer("total_checks").notNull(),
    downChecks: integer("down_checks").notNull(),
    downMinutes: integer("down_minutes").notNull(),
    totalLatencyMs: integer("total_latency_ms").notNull().default(0),
    minLatencyMs: integer("min_latency_ms"),
    maxLatencyMs: integer("max_latency_ms"),
    latestStatus: integer("latest_status", { mode: "boolean" }).notNull(),
    latestCheckedAt: integer("latest_checked_at", {
      mode: "timestamp_ms",
    }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.name, table.dayStartAt] }),
    index("idx_summaries_day").on(table.dayStartAt),
  ],
);

/** Manual and automatically opened service incidents. */
export const incidents = sqliteTable(
  "incidents",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    status: text("status").notNull(),
    severity: text("severity").notNull(),
    affectedMonitors: text("affected_monitors").notNull(),
    auto: integer("auto", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("idx_incidents_status").on(table.status),
    index("idx_incidents_created").on(table.createdAt),
  ],
);

/** Chronological, public-facing entries for an incident. */
export const incidentUpdates = sqliteTable(
  "incident_updates",
  {
    id: text("id").primaryKey(),
    incidentId: text("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    message: text("message").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("idx_incident_updates_incident").on(
      table.incidentId,
      table.createdAt,
    ),
  ],
);

/** Planned monitor maintenance, whose state is derived from its schedule. */
export const maintenanceWindows = sqliteTable(
  "maintenance_windows",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    affectedMonitors: text("affected_monitors").notNull(),
    scheduledStart: integer("scheduled_start", {
      mode: "timestamp_ms",
    }).notNull(),
    scheduledEnd: integer("scheduled_end", {
      mode: "timestamp_ms",
    }).notNull(),
    status: text("status").notNull().default("scheduled"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("idx_maintenance_status").on(table.status, table.scheduledStart),
  ],
);

/** Public email and webhook destinations. RSS and Atom are URL-based feeds. */
export const subscribers = sqliteTable(
  "subscribers",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    target: text("target").notNull(),
    confirmed: integer("confirmed", { mode: "boolean" })
      .notNull()
      .default(false),
    confirmToken: text("confirm_token"),
    /** JSON array; null means events for all configured monitors. */
    monitors: text("monitors"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("idx_subscribers_type_confirmed").on(table.type, table.confirmed),
    index("idx_subscribers_confirm_token").on(table.confirmToken),
  ],
);

/** Delivery outcomes. Payloads and provider credentials are deliberately never stored. */
export const notificationLog = sqliteTable(
  "notification_log",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id").notNull(),
    channelType: text("channel_type").notNull(),
    eventType: text("event_type").notNull(),
    status: text("status").notNull(),
    attempts: integer("attempts").notNull().default(1),
    error: text("error"),
    monitorName: text("monitor_name"),
    incidentId: text("incident_id"),
    maintenanceId: text("maintenance_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("idx_notification_log_created").on(table.createdAt),
    index("idx_notification_log_channel_created").on(
      table.channelId,
      table.createdAt,
    ),
    index("idx_notification_log_event_created").on(
      table.eventType,
      table.createdAt,
    ),
  ],
);

export const statusSchema = {
  statusResults,
  statusDailySummaries,
  incidents,
  incidentUpdates,
  maintenanceWindows,
  subscribers,
  notificationLog,
};

export type StatusResultRow = typeof statusResults.$inferSelect;
export type StatusDailySummaryRow = typeof statusDailySummaries.$inferSelect;
export type IncidentRow = typeof incidents.$inferSelect;
export type IncidentUpdateRow = typeof incidentUpdates.$inferSelect;
export type MaintenanceWindowRow = typeof maintenanceWindows.$inferSelect;
export type SubscriberRow = typeof subscribers.$inferSelect;
export type NotificationLogRow = typeof notificationLog.$inferSelect;
