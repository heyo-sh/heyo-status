import { createRequire } from "node:module";
import { and, asc, gte, inArray, lt, sql } from "drizzle-orm";
import type { Database } from "bun:sqlite";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

import type {
  CheckResult,
  DailySummary,
  Incident,
  IncidentListOptions,
  IncidentSeverity,
  IncidentStatus,
  IncidentUpdate,
  Maintenance,
  MaintenanceStatus,
  MaintenanceUpdate,
  NewNotificationLog,
  NotificationChannelType,
  NotificationDeliveryStatus,
  NotificationLog,
  NotificationLogOptions,
  NewIncident,
  NewMaintenance,
  NewSubscriber,
  SnapshotData,
  StatusDatabaseAdapter,
  StatusMonitorConfig,
  Subscriber,
  SubscriberListOptions,
  SubscriberType,
  SummarizeResult,
} from "../types";
import { createId } from "../ids";
import { mergeMaintenance } from "./maintenance";
import { NodeSqliteStatusDatabase } from "./node-sqlite";
import {
  incidentsMaintenanceMigrationId,
  incidentsMaintenanceMigrationSql,
  notificationLogMigrationId,
  notificationLogMigrationSql,
  subscriberUniquenessMigrationId,
  subscriberUniquenessMigrationSql,
  subscribersMigrationId,
  subscribersMigrationSql,
  initialMigrationId,
  initialMigrationSql,
} from "./migration";
import {
  statusDailySummaries,
  statusResults,
  statusSchema,
  type StatusDailySummaryRow,
  type StatusResultRow,
} from "./schema";

const dayMs = 24 * 60 * 60 * 1000;
const minuteMs = 60 * 1000;

// Both drivers are resolved through `createRequire` rather than a static
// import. A static `bun:sqlite` import is hoisted by the bundler, which would
// make every module that merely re-exports this adapter unloadable outside
// Bun — including the Node and serverless builds of a generated project.
// Resolve only when invoked: a Worker bundle has no import.meta.url at module
// evaluation time, even if it never uses SQLite.
function bunSqlite(): typeof import("bun:sqlite") {
  try {
    return createRequire(import.meta.url)(
      "bun:sqlite",
    ) as typeof import("bun:sqlite");
  } catch {
    throw new Error(
      "SQLiteStatusDatabase requires the Bun runtime. Use sqlite() for a portable adapter, or choose D1 or PostgreSQL.",
    );
  }
}

function bunDrizzle(): typeof import("drizzle-orm/bun-sqlite") {
  return createRequire(import.meta.url)(
    "drizzle-orm/bun-sqlite",
  ) as typeof import("drizzle-orm/bun-sqlite");
}

/**
 * True when `bun:sqlite` can back a synchronous embedded database. The Bun
 * global is checked instead of module resolution because bundlers such as
 * Turbopack and Vite rewrite `require.resolve` and would otherwise report a
 * Bun-only builtin as available inside a Node server build.
 */
export function hasBunSqlite(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
}

const incidentStatuses = new Set<IncidentStatus>([
  "investigating",
  "identified",
  "monitoring",
  "resolved",
]);
const incidentSeverities = new Set<IncidentSeverity>([
  "minor",
  "major",
  "critical",
]);
const maintenanceStatuses = new Set<MaintenanceStatus>([
  "scheduled",
  "in-progress",
  "completed",
]);
const notificationChannelTypes = new Set<NotificationChannelType>([
  "slack",
  "discord",
  "webhook",
  "email",
]);
const notificationDeliveryStatuses = new Set<NotificationDeliveryStatus>([
  "sent",
  "failed",
]);
const subscriberTypes = new Set<SubscriberType>(["email", "webhook"]);
const statusEventTypes = new Set([
  "monitor.down",
  "monitor.recovered",
  "ssl.expiring",
  "incident.created",
  "incident.updated",
  "incident.resolved",
  "maintenance.scheduled",
  "maintenance.starting",
  "maintenance.completed",
]);

export interface SQLiteStatusDatabaseOptions {
  /** SQLite filename; use `:memory:` for tests or transient local state. */
  file?: string;
  /** Existing Bun SQLite client. Useful when the caller owns its lifecycle. */
  client?: Database;
  /** Applies bundled migrations on construction. Defaults to true. */
  migrate?: boolean;
}

export interface ListCheckResultsOptions {
  names?: readonly string[];
  from?: Date;
  to?: Date;
  limit?: number;
}

interface SqlIncidentRow {
  id: string;
  title: string;
  status: string;
  severity: string;
  affected_monitors: string;
  auto: number;
  created_at: number;
  updated_at: number;
  resolved_at: number | null;
}

interface SqlIncidentUpdateRow {
  id: string;
  status: string;
  message: string;
  created_at: number;
}

interface SqlMaintenanceRow {
  id: string;
  title: string;
  description: string;
  affected_monitors: string;
  scheduled_start: number;
  scheduled_end: number;
  status: string;
  created_at: number;
}

interface SqlSubscriberRow {
  id: string;
  type: string;
  target: string;
  confirmed: number;
  confirm_token: string | null;
  monitors: string | null;
  created_at: number;
}

interface SqlNotificationLogRow {
  id: string;
  channel_id: string;
  channel_type: string;
  event_type: string;
  status: string;
  attempts: number;
  error: string | null;
  monitor_name: string | null;
  incident_id: string | null;
  maintenance_id: string | null;
  created_at: number;
}

/** Drizzle-backed local SQLite adapter. */
export class SQLiteStatusDatabase implements StatusDatabaseAdapter {
  readonly client: Database;
  private readonly db: BunSQLiteDatabase<typeof statusSchema>;

  constructor(options: SQLiteStatusDatabaseOptions = {}) {
    if (options.client && options.file) {
      throw new Error("Pass either SQLite client or file, not both.");
    }

    this.client =
      options.client ??
      new (bunSqlite().Database)(options.file ?? "status.sqlite");
    if (options.migrate !== false) applyStatusMigrations(this.client);
    this.db = bunDrizzle().drizzle(this.client, { schema: statusSchema });
  }

  /** Closes the underlying SQLite connection. */
  close(): void {
    this.client.close();
  }

  async insertCheckResults(results: CheckResult[]): Promise<void> {
    if (results.length === 0) return;

    const rows = results.map((result) => {
      assertDate(
        result.checkedAt,
        `Check result ${JSON.stringify(result.name)} checkedAt`,
      );
      return {
        name: result.name,
        type: result.type,
        status: result.status,
        latencyMs: Math.max(0, Math.trunc(result.latencyMs)),
        message: result.message,
        createdAt: result.checkedAt,
      };
    });

    await this.db.insert(statusResults).values(rows);
  }

  /** Lists raw observations in chronological order. */
  async listResults(
    options: ListCheckResultsOptions = {},
  ): Promise<CheckResult[]> {
    if (options.names?.length === 0 || options.limit === 0) return [];
    if (options.from) assertDate(options.from, "listResults.from");
    if (options.to) assertDate(options.to, "listResults.to");

    const conditions = [
      options.names?.length
        ? inArray(statusResults.name, [...options.names])
        : undefined,
      options.from ? gte(statusResults.createdAt, options.from) : undefined,
      options.to ? lt(statusResults.createdAt, options.to) : undefined,
    ].filter((condition) => condition !== undefined);
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const query = this.db
      .select()
      .from(statusResults)
      .where(where)
      .orderBy(asc(statusResults.createdAt), asc(statusResults.id));
    const rows = await query;
    const limit =
      options.limit === undefined
        ? undefined
        : Math.max(0, Math.floor(options.limit));

    return (limit === undefined ? rows : rows.slice(0, limit)).map(
      toCheckResult,
    );
  }

  async getSnapshot(
    monitors: string[],
    displayDays: number,
    now = new Date(),
  ): Promise<SnapshotData> {
    if (monitors.length === 0) return { results: [], dailySummaries: [] };
    assertPositiveInteger(displayDays, "displayDays");
    assertDate(now, "getSnapshot.now");

    // The snapshot grid includes today and displayDays - 1 preceding UTC days.
    // Fetch the full first day so its daily aggregate and DayGrid cell agree.
    const from = new Date(
      startOfUtcDay(now).getTime() - (displayDays - 1) * dayMs,
    );
    const [resultRows, summaryRows] = await Promise.all([
      this.db
        .select()
        .from(statusResults)
        .where(
          and(
            inArray(statusResults.name, monitors),
            gte(statusResults.createdAt, from),
          ),
        )
        .orderBy(
          asc(statusResults.name),
          asc(statusResults.createdAt),
          asc(statusResults.id),
        ),
      this.db
        .select()
        .from(statusDailySummaries)
        .where(
          and(
            inArray(statusDailySummaries.name, monitors),
            gte(statusDailySummaries.dayStartAt, from),
          ),
        )
        .orderBy(
          asc(statusDailySummaries.name),
          asc(statusDailySummaries.dayStartAt),
        ),
    ]);

    return {
      results: resultRows.map(toCheckResult),
      dailySummaries: summaryRows.map(toDailySummary),
    };
  }

  /**
   * Compacts complete UTC days strictly before `before` into daily aggregates.
   * It is safe to call repeatedly: existing day rows are updated and the raw
   * rows are deleted only after their aggregate has been written.
   */
  async summarizeHistory(before: Date): Promise<SummarizeResult> {
    assertDate(before, "summarizeHistory.before");
    const cutoff = startOfUtcDay(before);
    const rows = await this.db
      .select()
      .from(statusResults)
      .where(lt(statusResults.createdAt, cutoff))
      .orderBy(
        asc(statusResults.name),
        asc(statusResults.createdAt),
        asc(statusResults.id),
      );

    if (rows.length === 0) {
      return { summarizedDays: 0, summarizedResults: 0, deletedResults: 0 };
    }

    const summaries = buildDailySummaries(rows);
    await this.db
      .insert(statusDailySummaries)
      .values(summaries)
      .onConflictDoUpdate({
        target: [statusDailySummaries.name, statusDailySummaries.dayStartAt],
        set: {
          totalChecks: sql`excluded.total_checks`,
          downChecks: sql`excluded.down_checks`,
          downMinutes: sql`excluded.down_minutes`,
          totalLatencyMs: sql`excluded.total_latency_ms`,
          minLatencyMs: sql`excluded.min_latency_ms`,
          maxLatencyMs: sql`excluded.max_latency_ms`,
          latestStatus: sql`excluded.latest_status`,
          latestCheckedAt: sql`excluded.latest_checked_at`,
        },
      });
    await this.db
      .delete(statusResults)
      .where(lt(statusResults.createdAt, cutoff));

    return {
      summarizedDays: summaries.length,
      summarizedResults: rows.length,
      deletedResults: rows.length,
    };
  }

  /** Removes both raw and compacted observations outside the configured retention window. */
  async cleanup(retentionDays: number, now = new Date()): Promise<void> {
    assertPositiveInteger(retentionDays, "retentionDays");
    assertDate(now, "cleanup.now");
    const rawCutoff = new Date(now.getTime() - retentionDays * dayMs);
    const summaryCutoff = new Date(
      startOfUtcDay(now).getTime() - Math.max(retentionDays - 1, 0) * dayMs,
    );

    await this.db
      .delete(statusResults)
      .where(lt(statusResults.createdAt, rawCutoff));
    await this.db
      .delete(statusDailySummaries)
      .where(lt(statusDailySummaries.dayStartAt, summaryCutoff));
  }

  async createIncident(input: NewIncident): Promise<Incident> {
    const title = requireText(input.title, "Incident title");
    const message = requireText(input.message, "Incident message");
    const severity = assertIncidentSeverity(input.severity);
    const status = assertIncidentStatus(input.status ?? "investigating");
    if (status === "resolved") {
      throw new Error("A new incident cannot be created as resolved.");
    }

    const createdAt = new Date();
    const id = createId("inc");
    const updateId = createId("upd");
    const affectedMonitors = normaliseMonitorNames(input.affectedMonitors);
    const auto = input.auto === true;

    this.client
      .query(
        `INSERT INTO incidents (
          id, title, status, severity, affected_monitors, auto,
          created_at, updated_at, resolved_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .run(
        id,
        title,
        status,
        severity,
        JSON.stringify(affectedMonitors),
        auto ? 1 : 0,
        createdAt.getTime(),
        createdAt.getTime(),
      );
    this.client
      .query(
        `INSERT INTO incident_updates (id, incident_id, status, message, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(updateId, id, status, message, createdAt.getTime());

    const incident = await this.getIncident(id);
    if (!incident) throw new Error("Created incident could not be read.");
    return incident;
  }

  async updateIncident(id: string, update: IncidentUpdate): Promise<Incident> {
    const incident = await this.requireIncident(id);
    const status = assertIncidentStatus(update.status);
    const message = requireText(update.message, "Incident update message");
    const createdAt = validDateOrNow(
      update.createdAt,
      "Incident update createdAt",
    );
    const severity = update.severity
      ? assertIncidentSeverity(update.severity)
      : incident.severity;
    const updateId = update.id.trim() || createId("upd");
    const resolvedAt = status === "resolved" ? createdAt.getTime() : null;

    this.client
      .query(
        `UPDATE incidents
         SET status = ?, severity = ?, updated_at = ?, resolved_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(status, severity, createdAt.getTime(), resolvedAt, id);
    this.client
      .query(
        `INSERT INTO incident_updates (id, incident_id, status, message, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(updateId, id, status, message, createdAt.getTime());

    const result = await this.getIncident(id);
    if (!result) throw new Error(`Incident ${JSON.stringify(id)} was deleted.`);
    return result;
  }

  async resolveIncident(id: string, message: string): Promise<Incident> {
    const incident = await this.requireIncident(id);
    if (incident.status === "resolved") return incident;

    return this.updateIncident(id, {
      id: createId("upd"),
      status: "resolved",
      message,
      createdAt: new Date(),
    });
  }

  async listIncidents(options: IncidentListOptions = {}): Promise<Incident[]> {
    const conditions = ["deleted_at IS NULL"];
    const values: Array<string | number> = [];
    const statuses = arrayify(options.status);
    const severities = arrayify(options.severity);

    if (statuses.length > 0) {
      statuses.forEach((status) => assertIncidentStatus(status));
      conditions.push(`status IN (${statuses.map(() => "?").join(", ")})`);
      values.push(...statuses);
    }
    if (severities.length > 0) {
      severities.forEach((severity) => assertIncidentSeverity(severity));
      conditions.push(`severity IN (${severities.map(() => "?").join(", ")})`);
      values.push(...severities);
    }
    if (options.from) {
      assertDate(options.from, "listIncidents.from");
      conditions.push("created_at >= ?");
      values.push(options.from.getTime());
    }
    if (options.to) {
      assertDate(options.to, "listIncidents.to");
      conditions.push("created_at < ?");
      values.push(options.to.getTime());
    }

    let statement = `SELECT id, title, status, severity, affected_monitors, auto,
                            created_at, updated_at, resolved_at
                     FROM incidents
                     WHERE ${conditions.join(" AND ")}
                     ORDER BY created_at DESC, id DESC`;
    if (options.limit !== undefined) {
      const limit = normalisePagination(options.limit, "listIncidents.limit");
      statement += " LIMIT ?";
      values.push(limit);
      if (options.offset !== undefined) {
        statement += " OFFSET ?";
        values.push(
          normalisePagination(options.offset, "listIncidents.offset"),
        );
      }
    } else if (options.offset !== undefined) {
      statement += " LIMIT -1 OFFSET ?";
      values.push(normalisePagination(options.offset, "listIncidents.offset"));
    }

    const rows = this.client
      .query(statement)
      .all(...values) as SqlIncidentRow[];
    return Promise.all(rows.map((row) => this.toIncident(row)));
  }

  async getIncident(id: string): Promise<Incident | null> {
    const row = this.client
      .query(
        `SELECT id, title, status, severity, affected_monitors, auto,
                created_at, updated_at, resolved_at
         FROM incidents WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(id) as SqlIncidentRow | null;
    return row ? this.toIncident(row) : null;
  }

  async deleteIncident(id: string): Promise<void> {
    const incident = await this.requireIncident(id);
    const deletedAt = Date.now();
    this.client
      .query("UPDATE incidents SET deleted_at = ?, updated_at = ? WHERE id = ?")
      .run(deletedAt, deletedAt, incident.id);
  }

  async createMaintenance(input: NewMaintenance): Promise<Maintenance> {
    const title = requireText(input.title, "Maintenance title");
    const description = input.description?.trim() ?? "";
    const scheduledStart = validDateOrThrow(
      input.scheduledStart,
      "Maintenance scheduledStart",
    );
    const scheduledEnd = validDateOrThrow(
      input.scheduledEnd,
      "Maintenance scheduledEnd",
    );
    if (scheduledEnd.getTime() <= scheduledStart.getTime()) {
      throw new Error("Maintenance scheduledEnd must be after scheduledStart.");
    }

    const createdAt = new Date();
    const status = maintenanceStatusAt(scheduledStart, scheduledEnd, createdAt);
    const id = createId("mnt");
    const affectedMonitors = normaliseMonitorNames(input.affectedMonitors);
    this.client
      .query(
        `INSERT INTO maintenance_windows (
          id, title, description, affected_monitors, scheduled_start,
          scheduled_end, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        title,
        description,
        JSON.stringify(affectedMonitors),
        scheduledStart.getTime(),
        scheduledEnd.getTime(),
        status,
        createdAt.getTime(),
      );

    return {
      id,
      title,
      description,
      affectedMonitors,
      scheduledStart,
      scheduledEnd,
      status,
      createdAt,
    };
  }

  async listUpcoming(now = new Date()): Promise<Maintenance[]> {
    assertDate(now, "listUpcoming.now");
    const at = now.getTime();
    // State is intentionally derived lazily as well as when a window is
    // created. No long-running worker is needed to keep public status correct.
    this.client
      .query(
        `UPDATE maintenance_windows SET status = 'completed'
         WHERE status != 'completed' AND scheduled_end <= ?`,
      )
      .run(at);
    this.client
      .query(
        `UPDATE maintenance_windows SET status = 'in-progress'
         WHERE status = 'scheduled' AND scheduled_start <= ? AND scheduled_end > ?`,
      )
      .run(at, at);

    const rows = this.client
      .query(
        `SELECT id, title, description, affected_monitors, scheduled_start,
                scheduled_end, status, created_at
         FROM maintenance_windows
         WHERE status != 'completed'
         ORDER BY scheduled_start ASC, id ASC`,
      )
      .all() as SqlMaintenanceRow[];
    return rows.map(toMaintenance);
  }

  async getMaintenance(id: string): Promise<Maintenance | null> {
    const row = this.client
      .query(
        `SELECT id, title, description, affected_monitors, scheduled_start,
                scheduled_end, status, created_at
         FROM maintenance_windows WHERE id = ?`,
      )
      .get(id) as SqlMaintenanceRow | null;
    return row ? toMaintenance(row) : null;
  }

  async updateMaintenance(
    id: string,
    update: MaintenanceUpdate,
  ): Promise<Maintenance> {
    const current = await this.getMaintenance(id);
    if (!current) {
      throw new Error(
        `Maintenance window ${JSON.stringify(id)} was not found.`,
      );
    }

    const next = mergeMaintenance(current, update);
    this.client
      .query(
        `UPDATE maintenance_windows
         SET title = ?, description = ?, affected_monitors = ?,
             scheduled_start = ?, scheduled_end = ?, status = ?
         WHERE id = ?`,
      )
      .run(
        next.title,
        next.description,
        JSON.stringify(next.affectedMonitors),
        next.scheduledStart.getTime(),
        next.scheduledEnd.getTime(),
        next.status,
        id,
      );
    return next;
  }

  async deleteMaintenance(id: string): Promise<void> {
    const current = await this.getMaintenance(id);
    if (!current) {
      throw new Error(
        `Maintenance window ${JSON.stringify(id)} was not found.`,
      );
    }
    this.client.query("DELETE FROM maintenance_windows WHERE id = ?").run(id);
  }

  async createSubscriber(input: NewSubscriber): Promise<Subscriber> {
    const type = assertSubscriberType(input.type);
    const target = requireText(input.target, "Subscriber target");
    const confirmed = input.confirmed === true;
    const confirmToken = confirmed
      ? null
      : optionalText(
          input.confirmToken ?? undefined,
          "Subscriber confirmToken",
        );
    if (!confirmed && !confirmToken) {
      throw new Error("Unconfirmed subscribers require a confirmation token.");
    }
    const monitors = normaliseSubscriberMonitors(input.monitors);
    const createdAt = new Date();
    const id = createId("sub");

    this.client
      .query(
        `INSERT INTO subscribers (
          id, type, target, confirmed, confirm_token, monitors, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        type,
        target,
        confirmed ? 1 : 0,
        confirmToken,
        monitors === null ? null : JSON.stringify(monitors),
        createdAt.getTime(),
      );

    return { id, type, target, confirmed, monitors, createdAt };
  }

  async confirmSubscriber(confirmToken: string): Promise<Subscriber | null> {
    const token = requireText(confirmToken, "Subscriber confirmation token");
    const row = this.client
      .query(
        `SELECT id, type, target, confirmed, confirm_token, monitors, created_at
         FROM subscribers WHERE confirm_token = ?`,
      )
      .get(token) as SqlSubscriberRow | null;
    if (!row) return null;

    this.client
      .query(
        `UPDATE subscribers
         SET confirmed = 1, confirm_token = NULL
         WHERE id = ?`,
      )
      .run(row.id);
    return { ...toSubscriber(row), confirmed: true };
  }

  async listSubscribers(
    options: SubscriberListOptions = {},
  ): Promise<Subscriber[]> {
    const conditions: string[] = [];
    const values: Array<string | number> = [];
    if (options.type) {
      conditions.push("type = ?");
      values.push(assertSubscriberType(options.type));
    }
    if (options.confirmed !== undefined) {
      conditions.push("confirmed = ?");
      values.push(options.confirmed ? 1 : 0);
    }
    const rows = this.client
      .query(
        `SELECT id, type, target, confirmed, confirm_token, monitors, created_at
         FROM subscribers
         ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
         ORDER BY created_at ASC, id ASC`,
      )
      .all(...values) as SqlSubscriberRow[];
    return rows.map(toSubscriber);
  }

  async deleteSubscriber(id: string): Promise<boolean> {
    const subscriberId = requireText(id, "Subscriber id");
    const existing = this.client
      .query("SELECT id FROM subscribers WHERE id = ?")
      .get(subscriberId) as { id: string } | null;
    if (!existing) return false;
    this.client.query("DELETE FROM subscribers WHERE id = ?").run(subscriberId);
    return true;
  }

  async recordNotification(
    input: NewNotificationLog,
  ): Promise<NotificationLog> {
    const channelId = requireText(input.channelId, "Notification channelId");
    const channelType = assertNotificationChannelType(input.channelType);
    const eventType = assertStatusEventType(input.eventType);
    const status = assertNotificationDeliveryStatus(input.status);
    const attempts = normaliseNotificationAttempts(input.attempts ?? 1);
    const createdAt = input.createdAt
      ? validDateOrThrow(input.createdAt, "Notification createdAt")
      : new Date();
    const error = input.error === undefined ? null : input.error;
    if (error !== null && typeof error !== "string") {
      throw new Error("Notification error must be a string or null.");
    }
    const monitorName = optionalText(
      input.monitorName,
      "Notification monitorName",
    );
    const incidentId = optionalText(
      input.incidentId,
      "Notification incidentId",
    );
    const maintenanceId = optionalText(
      input.maintenanceId,
      "Notification maintenanceId",
    );
    const id = createId("ntf");

    this.client
      .query(
        `INSERT INTO notification_log (
          id, channel_id, channel_type, event_type, status, attempts, error,
          monitor_name, incident_id, maintenance_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        channelId,
        channelType,
        eventType,
        status,
        attempts,
        error,
        monitorName,
        incidentId,
        maintenanceId,
        createdAt.getTime(),
      );

    return {
      id,
      channelId,
      channelType,
      eventType,
      status,
      attempts,
      error,
      monitorName,
      incidentId,
      maintenanceId,
      createdAt,
    };
  }

  async listNotificationLog(
    options: NotificationLogOptions = {},
  ): Promise<NotificationLog[]> {
    const conditions: string[] = [];
    const values: Array<string | number> = [];
    if (options.channelId) {
      conditions.push("channel_id = ?");
      values.push(requireText(options.channelId, "Notification channelId"));
    }
    const eventTypes = arrayify(options.eventType);
    if (eventTypes.length > 0) {
      eventTypes.forEach((eventType) => assertStatusEventType(eventType));
      conditions.push(
        `event_type IN (${eventTypes.map(() => "?").join(", ")})`,
      );
      values.push(...eventTypes);
    }
    const statuses = arrayify(options.status);
    if (statuses.length > 0) {
      statuses.forEach((status) => assertNotificationDeliveryStatus(status));
      conditions.push(`status IN (${statuses.map(() => "?").join(", ")})`);
      values.push(...statuses);
    }

    let statement = `SELECT id, channel_id, channel_type, event_type, status,
                            attempts, error, monitor_name, incident_id,
                            maintenance_id, created_at
                     FROM notification_log
                     ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
                     ORDER BY created_at DESC, id DESC`;
    if (options.limit !== undefined) {
      statement += " LIMIT ?";
      values.push(
        normalisePagination(options.limit, "listNotificationLog.limit"),
      );
      if (options.offset !== undefined) {
        statement += " OFFSET ?";
        values.push(
          normalisePagination(options.offset, "listNotificationLog.offset"),
        );
      }
    } else if (options.offset !== undefined) {
      statement += " LIMIT -1 OFFSET ?";
      values.push(
        normalisePagination(options.offset, "listNotificationLog.offset"),
      );
    }

    const rows = this.client
      .query(statement)
      .all(...values) as SqlNotificationLogRow[];
    return rows.map(toNotificationLog);
  }

  private async requireIncident(id: string): Promise<Incident> {
    const incident = await this.getIncident(id);
    if (!incident)
      throw new Error(`Incident ${JSON.stringify(id)} was not found.`);
    return incident;
  }

  private async toIncident(row: SqlIncidentRow): Promise<Incident> {
    const updates = this.client
      .query(
        `SELECT id, status, message, created_at
         FROM incident_updates WHERE incident_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(row.id) as SqlIncidentUpdateRow[];

    return {
      id: row.id,
      title: row.title,
      status: assertIncidentStatus(row.status),
      severity: assertIncidentSeverity(row.severity),
      affectedMonitors: parseMonitorNames(row.affected_monitors),
      auto: row.auto === 1,
      updates: updates.map((update) => ({
        id: update.id,
        status: assertIncidentStatus(update.status),
        message: update.message,
        createdAt: new Date(update.created_at),
      })),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      resolvedAt: row.resolved_at === null ? null : new Date(row.resolved_at),
    };
  }
}

/**
 * The embedded SQLite surface shared by the Bun and Node implementations.
 * Configuration only needs {@link StatusDatabaseAdapter}; the extra members
 * exist for local tooling and tests.
 */
export type StatusSqliteDatabase = Required<StatusDatabaseAdapter> & {
  /** Closes the underlying SQLite connection. */
  close(): void;
  /** Lists raw observations in chronological order. */
  listResults(options?: ListCheckResultsOptions): Promise<CheckResult[]>;
};

/**
 * Creates a migrated embedded SQLite database for the current runtime.
 *
 * Bun is served by the Drizzle/`bun:sqlite` adapter. Every other runtime falls
 * back to `node:sqlite`, so a generated project keeps working under
 * `next start`, `react-router-serve` and a Node-hosted Astro server.
 */
export function sqlite(
  options: SQLiteStatusDatabaseOptions | string = {},
): StatusSqliteDatabase {
  const resolved = typeof options === "string" ? { file: options } : options;
  if (resolved.client || hasBunSqlite()) {
    return new SQLiteStatusDatabase(resolved);
  }
  return new NodeSqliteStatusDatabase({
    ...(resolved.file === undefined ? {} : { file: resolved.file }),
    ...(resolved.migrate === undefined ? {} : { migrate: resolved.migrate }),
  });
}

/** Applies each migration once, tracking it in an internal SQLite table. */
export function applyStatusMigrations(client: Database): void {
  client.exec("PRAGMA foreign_keys = ON;");
  client.exec(`
    CREATE TABLE IF NOT EXISTS __heyo_status_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  for (const migration of [
    { id: initialMigrationId, sql: initialMigrationSql },
    {
      id: incidentsMaintenanceMigrationId,
      sql: incidentsMaintenanceMigrationSql,
    },
    { id: notificationLogMigrationId, sql: notificationLogMigrationSql },
    { id: subscribersMigrationId, sql: subscribersMigrationSql },
    {
      id: subscriberUniquenessMigrationId,
      sql: subscriberUniquenessMigrationSql,
    },
  ]) {
    const applied = client
      .query("SELECT id FROM __heyo_status_migrations WHERE id = ?")
      .get(migration.id) as { id: string } | null;
    if (applied) continue;

    client.exec(migration.sql);
    client
      .query(
        "INSERT INTO __heyo_status_migrations (id, applied_at) VALUES (?, ?)",
      )
      .run(migration.id, Date.now());
  }
}

function buildDailySummaries(rows: StatusResultRow[]) {
  const rowsByDay = new Map<string, StatusResultRow[]>();
  for (const row of rows) {
    const dayStartMs = utcDayStartMs(row.createdAt);
    const key = `${row.name}\u0000${dayStartMs}`;
    const dayRows = rowsByDay.get(key);
    if (dayRows) dayRows.push(row);
    else rowsByDay.set(key, [row]);
  }

  return [...rowsByDay.values()].map((dayRows) => {
    const first = dayRows[0];
    if (!first) throw new Error("Cannot summarize an empty result day.");

    const dayStartMs = utcDayStartMs(first.createdAt);
    const dayEndMs = dayStartMs + dayMs;
    let downChecks = 0;
    let downMs = 0;
    let totalLatencyMs = 0;
    let minLatencyMs: number | null = null;
    let maxLatencyMs: number | null = null;

    for (const [index, row] of dayRows.entries()) {
      const latency = Math.max(0, row.latencyMs);
      totalLatencyMs += latency;
      minLatencyMs =
        minLatencyMs === null ? latency : Math.min(minLatencyMs, latency);
      maxLatencyMs =
        maxLatencyMs === null ? latency : Math.max(maxLatencyMs, latency);

      if (!row.status) {
        downChecks += 1;
        const next = dayRows[index + 1];
        const endedAt = Math.min(
          next?.createdAt.getTime() ?? dayEndMs,
          dayEndMs,
        );
        downMs += Math.max(0, endedAt - row.createdAt.getTime());
      }
    }

    const latest = dayRows.at(-1);
    if (!latest)
      throw new Error("Cannot determine latest result for an empty day.");

    return {
      name: first.name,
      dayStartAt: new Date(dayStartMs),
      totalChecks: dayRows.length,
      downChecks,
      downMinutes: Math.ceil(downMs / minuteMs),
      totalLatencyMs,
      minLatencyMs,
      maxLatencyMs,
      latestStatus: latest.status,
      latestCheckedAt: latest.createdAt,
    };
  });
}

function toCheckResult(row: StatusResultRow): CheckResult {
  return {
    name: row.name,
    type: row.type as StatusMonitorConfig["type"],
    status: row.status,
    message: row.message ?? "",
    latencyMs: row.latencyMs,
    checkedAt: row.createdAt,
  };
}

function toDailySummary(row: StatusDailySummaryRow): DailySummary {
  return {
    name: row.name,
    dayStartAt: row.dayStartAt,
    totalChecks: row.totalChecks,
    downChecks: row.downChecks,
    downMinutes: row.downMinutes,
    totalLatencyMs: row.totalLatencyMs,
    minLatencyMs: row.minLatencyMs,
    maxLatencyMs: row.maxLatencyMs,
    latestStatus: row.latestStatus,
    latestCheckedAt: row.latestCheckedAt,
  };
}

function toMaintenance(row: SqlMaintenanceRow): Maintenance {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    affectedMonitors: parseMonitorNames(row.affected_monitors),
    scheduledStart: new Date(row.scheduled_start),
    scheduledEnd: new Date(row.scheduled_end),
    status: assertMaintenanceStatus(row.status),
    createdAt: new Date(row.created_at),
  };
}

function toSubscriber(row: SqlSubscriberRow): Subscriber {
  return {
    id: row.id,
    type: assertSubscriberType(row.type),
    target: row.target,
    confirmed: row.confirmed === 1,
    monitors: parseSubscriberMonitors(row.monitors),
    createdAt: new Date(row.created_at),
  };
}

function toNotificationLog(row: SqlNotificationLogRow): NotificationLog {
  return {
    id: row.id,
    channelId: row.channel_id,
    channelType: assertNotificationChannelType(row.channel_type),
    eventType: assertStatusEventType(row.event_type),
    status: assertNotificationDeliveryStatus(row.status),
    attempts: normaliseNotificationAttempts(row.attempts),
    error: row.error,
    monitorName: row.monitor_name,
    incidentId: row.incident_id,
    maintenanceId: row.maintenance_id,
    createdAt: new Date(row.created_at),
  };
}

function startOfUtcDay(value: Date): Date {
  return new Date(utcDayStartMs(value));
}

function utcDayStartMs(value: Date): number {
  return Math.floor(value.getTime() / dayMs) * dayMs;
}

function assertDate(value: Date, name: string): void {
  if (!Number.isFinite(value.getTime()))
    throw new Error(`${name} must be a valid Date.`);
}

function validDateOrThrow(value: Date, name: string): Date {
  assertDate(value, name);
  return new Date(value);
}

function validDateOrNow(value: Date, name: string): Date {
  if (value === undefined) return new Date();
  return validDateOrThrow(value, name);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

function normalisePagination(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return value;
}

function requireText(value: string, name: string): string {
  const result = value.trim();
  if (!result) throw new Error(`${name} cannot be empty.`);
  return result;
}

function normaliseMonitorNames(value: string[]): string[] {
  if (!Array.isArray(value)) {
    throw new Error("affectedMonitors must be an array of monitor names.");
  }
  const names = value.map((name) => requireText(name, "Affected monitor"));
  return [...new Set(names)];
}

function parseMonitorNames(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      !parsed.every((item) => typeof item === "string")
    ) {
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
}

function normaliseSubscriberMonitors(
  value: string[] | null | undefined,
): string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw new Error(
      "Subscriber monitors must be an array of monitor names or null.",
    );
  }
  return [
    ...new Set(value.map((name) => requireText(name, "Subscriber monitor"))),
  ];
}

function parseSubscriberMonitors(value: string | null): string[] | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      !parsed.every((item) => typeof item === "string")
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function assertIncidentStatus(value: string): IncidentStatus {
  if (!incidentStatuses.has(value as IncidentStatus)) {
    throw new Error(`Unsupported incident status: ${JSON.stringify(value)}.`);
  }
  return value as IncidentStatus;
}

function assertIncidentSeverity(value: string): IncidentSeverity {
  if (!incidentSeverities.has(value as IncidentSeverity)) {
    throw new Error(`Unsupported incident severity: ${JSON.stringify(value)}.`);
  }
  return value as IncidentSeverity;
}

function assertSubscriberType(value: string): SubscriberType {
  if (!subscriberTypes.has(value as SubscriberType)) {
    throw new Error(`Unsupported subscriber type: ${JSON.stringify(value)}.`);
  }
  return value as SubscriberType;
}

function assertMaintenanceStatus(value: string): MaintenanceStatus {
  if (!maintenanceStatuses.has(value as MaintenanceStatus)) {
    throw new Error(
      `Unsupported maintenance status: ${JSON.stringify(value)}.`,
    );
  }
  return value as MaintenanceStatus;
}

function assertNotificationChannelType(value: string): NotificationChannelType {
  if (!notificationChannelTypes.has(value as NotificationChannelType)) {
    throw new Error(
      `Unsupported notification channel type: ${JSON.stringify(value)}.`,
    );
  }
  return value as NotificationChannelType;
}

function assertNotificationDeliveryStatus(
  value: string,
): NotificationDeliveryStatus {
  if (!notificationDeliveryStatuses.has(value as NotificationDeliveryStatus)) {
    throw new Error(
      `Unsupported notification delivery status: ${JSON.stringify(value)}.`,
    );
  }
  return value as NotificationDeliveryStatus;
}

function assertStatusEventType(
  value: string,
): import("../types").StatusEventType {
  if (!statusEventTypes.has(value)) {
    throw new Error(
      `Unsupported notification event type: ${JSON.stringify(value)}.`,
    );
  }
  return value as import("../types").StatusEventType;
}

function normaliseNotificationAttempts(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Notification attempts must be a positive integer.");
  }
  return value;
}

function optionalText(value: string | undefined, name: string): string | null {
  if (value === undefined) return null;
  return requireText(value, name);
}

function maintenanceStatusAt(
  start: Date,
  end: Date,
  now: Date,
): MaintenanceStatus {
  if (end.getTime() <= now.getTime()) return "completed";
  if (start.getTime() <= now.getTime()) return "in-progress";
  return "scheduled";
}

function arrayify<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}
