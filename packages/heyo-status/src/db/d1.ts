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
  NewIncident,
  NewMaintenance,
  NewNotificationLog,
  NewSubscriber,
  NotificationChannelType,
  NotificationDeliveryStatus,
  NotificationLog,
  NotificationLogOptions,
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
import {
  incidentsMaintenanceMigrationSql,
  initialMigrationSql,
  notificationLogMigrationSql,
  subscriberUniquenessMigrationSql,
  subscribersMigrationSql,
} from "./migration";

/** Structural Cloudflare D1 binding; importing this package needs no Workers types. */
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(query: string): D1Statement;
  batch?(statements: D1Statement[]): Promise<unknown>;
  exec(query: string): Promise<unknown>;
}

export interface D1StatusDatabaseOptions {
  /** Applies bundled migrations at construction. Defaults to false for remote databases. */
  migrate?: boolean;
}

const dayMs = 86_400_000;
const minuteMs = 60_000;
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
const subscriberTypes = new Set<SubscriberType>(["email", "webhook"]);
const notificationTypes = new Set<NotificationChannelType>([
  "slack",
  "discord",
  "webhook",
  "email",
]);
const deliveryStatuses = new Set<NotificationDeliveryStatus>([
  "sent",
  "failed",
]);
const eventTypes = new Set([
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

type Row = Record<string, unknown>;

/** D1 implementation of the framework-neutral persistence contract. */
export class D1StatusDatabase implements StatusDatabaseAdapter {
  readonly binding: D1Database;
  private migration: Promise<void> | undefined;

  constructor(binding: D1Database, options: D1StatusDatabaseOptions = {}) {
    this.binding = binding;
    if (options.migrate === true) this.migration = this.migrate();
  }

  async migrate(): Promise<void> {
    await this.binding.exec("PRAGMA foreign_keys = ON;");
    await this.binding.exec(`
      CREATE TABLE IF NOT EXISTS __heyo_status_migrations (
        id TEXT PRIMARY KEY NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `);
    const migrations = [
      ["0000_initial", initialMigrationSql],
      ["0001_incidents_maintenance", incidentsMaintenanceMigrationSql],
      ["0002_notification_log", notificationLogMigrationSql],
      ["0003_subscribers", subscribersMigrationSql],
      ["0004_subscriber_uniqueness", subscriberUniquenessMigrationSql],
    ] as const;
    for (const [id, sql] of migrations) {
      const applied = await this.binding
        .prepare("SELECT id FROM __heyo_status_migrations WHERE id = ?")
        .bind(id)
        .all<{ id: string }>();
      if (applied.results?.[0]) continue;
      await this.binding.exec(sql);
      await this.binding
        .prepare(
          "INSERT INTO __heyo_status_migrations (id, applied_at) VALUES (?, ?)",
        )
        .bind(id, Date.now())
        .run();
    }
  }

  protected async ready(): Promise<void> {
    await this.migration;
  }

  private async all<T extends Row>(
    sql: string,
    values: unknown[] = [],
  ): Promise<T[]> {
    await this.ready();
    return (
      (
        await this.binding
          .prepare(sql)
          .bind(...values)
          .all<T>()
      ).results ?? []
    );
  }

  private async run(sql: string, values: unknown[] = []): Promise<void> {
    await this.ready();
    await this.binding
      .prepare(sql)
      .bind(...values)
      .run();
  }

  async insertCheckResults(results: CheckResult[]): Promise<void> {
    if (results.length === 0) return;
    const statements = results.map((result) =>
      this.binding
        .prepare(
          `INSERT INTO status_results (name, type, status, latency_ms, message, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          result.name,
          result.type,
          result.status ? 1 : 0,
          Math.max(0, Math.trunc(result.latencyMs)),
          result.message,
          dateMs(result.checkedAt, "checkedAt"),
        ),
    );
    await this.ready();
    if (this.binding.batch) await this.binding.batch(statements);
    else await Promise.all(statements.map((statement) => statement.run()));
  }

  async getSnapshot(
    monitors: string[],
    displayDays: number,
    now = new Date(),
  ): Promise<SnapshotData> {
    if (monitors.length === 0) return { results: [], dailySummaries: [] };
    positive(displayDays, "displayDays");
    const from = utcDay(
      new Date(dateMs(now, "now") - (displayDays - 1) * dayMs),
    );
    const placeholders = monitors.map(() => "?").join(", ");
    const [results, summaries] = await Promise.all([
      this.all<Row>(
        `SELECT name, type, status, latency_ms, message, created_at FROM status_results
         WHERE name IN (${placeholders}) AND created_at >= ? ORDER BY name, created_at, id`,
        [...monitors, from.getTime()],
      ),
      this.all<Row>(
        `SELECT name, day_start_at, total_checks, down_checks, down_minutes,
                total_latency_ms, min_latency_ms, max_latency_ms, latest_status, latest_checked_at
         FROM status_daily_summaries WHERE name IN (${placeholders}) AND day_start_at >= ?
         ORDER BY name, day_start_at`,
        [...monitors, from.getTime()],
      ),
    ]);
    return {
      results: results.map(checkResult),
      dailySummaries: summaries.map(summary),
    };
  }

  async summarizeHistory(before: Date): Promise<SummarizeResult> {
    const cutoff = utcDay(before);
    const rows = await this.all<Row>(
      `SELECT name, type, status, latency_ms, message, created_at FROM status_results
       WHERE created_at < ? ORDER BY name, created_at, id`,
      [cutoff.getTime()],
    );
    if (rows.length === 0)
      return { summarizedDays: 0, summarizedResults: 0, deletedResults: 0 };
    const summaries = compact(rows.map(checkResult));
    const statements = summaries.map((item) =>
      this.binding
        .prepare(
          `INSERT INTO status_daily_summaries (
            name, day_start_at, total_checks, down_checks, down_minutes, total_latency_ms,
            min_latency_ms, max_latency_ms, latest_status, latest_checked_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(name, day_start_at) DO UPDATE SET
            total_checks = excluded.total_checks, down_checks = excluded.down_checks,
            down_minutes = excluded.down_minutes, total_latency_ms = excluded.total_latency_ms,
            min_latency_ms = excluded.min_latency_ms, max_latency_ms = excluded.max_latency_ms,
            latest_status = excluded.latest_status, latest_checked_at = excluded.latest_checked_at`,
        )
        .bind(
          item.name,
          item.dayStartAt.getTime(),
          item.totalChecks,
          item.downChecks,
          item.downMinutes,
          item.totalLatencyMs,
          item.minLatencyMs,
          item.maxLatencyMs,
          item.latestStatus ? 1 : 0,
          item.latestCheckedAt.getTime(),
        ),
    );
    await this.ready();
    if (this.binding.batch) await this.binding.batch(statements);
    else await Promise.all(statements.map((statement) => statement.run()));
    await this.run("DELETE FROM status_results WHERE created_at < ?", [
      cutoff.getTime(),
    ]);
    return {
      summarizedDays: summaries.length,
      summarizedResults: rows.length,
      deletedResults: rows.length,
    };
  }

  async cleanup(retentionDays: number, now = new Date()): Promise<void> {
    positive(retentionDays, "retentionDays");
    const nowMs = dateMs(now, "now");
    await Promise.all([
      this.run("DELETE FROM status_results WHERE created_at < ?", [
        nowMs - retentionDays * dayMs,
      ]),
      this.run("DELETE FROM status_daily_summaries WHERE day_start_at < ?", [
        utcDay(new Date(nowMs - (retentionDays - 1) * dayMs)).getTime(),
      ]),
    ]);
  }

  async createIncident(input: NewIncident): Promise<Incident> {
    const now = new Date();
    const id = createId("inc");
    const status = incidentStatus(input.status ?? "investigating");
    if (status === "resolved")
      throw new Error("A new incident cannot be created as resolved.");
    const monitors = names(input.affectedMonitors, "Affected monitor");
    await this.run(
      `INSERT INTO incidents (id, title, status, severity, affected_monitors, auto, created_at, updated_at, resolved_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      [
        id,
        text(input.title, "Incident title"),
        status,
        severity(input.severity),
        JSON.stringify(monitors),
        input.auto ? 1 : 0,
        now.getTime(),
        now.getTime(),
      ],
    );
    await this.run(
      "INSERT INTO incident_updates (id, incident_id, status, message, created_at) VALUES (?, ?, ?, ?, ?)",
      [
        createId("upd"),
        id,
        status,
        text(input.message, "Incident message"),
        now.getTime(),
      ],
    );
    return this.requireIncident(id);
  }

  async updateIncident(id: string, update: IncidentUpdate): Promise<Incident> {
    const current = await this.requireIncident(id);
    const at = dateMs(update.createdAt, "Incident update createdAt");
    const status = incidentStatus(update.status);
    const nextSeverity = update.severity
      ? severity(update.severity)
      : current.severity;
    await this.run(
      "UPDATE incidents SET status = ?, severity = ?, updated_at = ?, resolved_at = ? WHERE id = ? AND deleted_at IS NULL",
      [status, nextSeverity, at, status === "resolved" ? at : null, id],
    );
    await this.run(
      "INSERT INTO incident_updates (id, incident_id, status, message, created_at) VALUES (?, ?, ?, ?, ?)",
      [
        text(update.id, "Incident update id"),
        id,
        status,
        text(update.message, "Incident update message"),
        at,
      ],
    );
    return this.requireIncident(id);
  }

  async resolveIncident(id: string, message: string): Promise<Incident> {
    const current = await this.requireIncident(id);
    return current.status === "resolved"
      ? current
      : this.updateIncident(id, {
          id: createId("upd"),
          status: "resolved",
          message,
          createdAt: new Date(),
        });
  }

  async listIncidents(options: IncidentListOptions = {}): Promise<Incident[]> {
    const conditions = ["deleted_at IS NULL"];
    const values: unknown[] = [];
    addIn(
      conditions,
      values,
      "status",
      list(options.status).map(incidentStatus),
    );
    addIn(conditions, values, "severity", list(options.severity).map(severity));
    if (options.from) {
      conditions.push("created_at >= ?");
      values.push(dateMs(options.from, "from"));
    }
    if (options.to) {
      conditions.push("created_at < ?");
      values.push(dateMs(options.to, "to"));
    }
    let sql = `SELECT id, title, status, severity, affected_monitors, auto, created_at, updated_at, resolved_at
      FROM incidents WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC, id DESC`;
    if (options.limit !== undefined) {
      sql += " LIMIT ?";
      values.push(page(options.limit));
      if (options.offset !== undefined) {
        sql += " OFFSET ?";
        values.push(page(options.offset));
      }
    } else if (options.offset !== undefined) {
      sql += " LIMIT -1 OFFSET ?";
      values.push(page(options.offset));
    }
    return Promise.all(
      (await this.all<Row>(sql, values)).map((row) => this.incident(row)),
    );
  }

  async getIncident(id: string): Promise<Incident | null> {
    const row = (
      await this.all<Row>(
        `SELECT id, title, status, severity, affected_monitors, auto, created_at, updated_at, resolved_at
       FROM incidents WHERE id = ? AND deleted_at IS NULL`,
        [id],
      )
    )[0];
    return row ? this.incident(row) : null;
  }

  async deleteIncident(id: string): Promise<void> {
    await this.requireIncident(id);
    await this.run(
      "UPDATE incidents SET deleted_at = ?, updated_at = ? WHERE id = ?",
      [Date.now(), Date.now(), id],
    );
  }

  private async requireIncident(id: string): Promise<Incident> {
    const incident = await this.getIncident(id);
    if (!incident)
      throw new Error(`Incident ${JSON.stringify(id)} was not found.`);
    return incident;
  }

  private async incident(row: Row): Promise<Incident> {
    const updates = await this.all<Row>(
      "SELECT id, status, message, created_at FROM incident_updates WHERE incident_id = ? ORDER BY created_at, id",
      [string(row.id)],
    );
    return {
      id: string(row.id),
      title: string(row.title),
      status: incidentStatus(string(row.status)),
      severity: severity(string(row.severity)),
      affectedMonitors: jsonNames(row.affected_monitors),
      auto: number(row.auto) === 1,
      updates: updates.map((update) => ({
        id: string(update.id),
        status: incidentStatus(string(update.status)),
        message: string(update.message),
        createdAt: date(update.created_at),
      })),
      createdAt: date(row.created_at),
      updatedAt: date(row.updated_at),
      resolvedAt: row.resolved_at === null ? null : date(row.resolved_at),
    };
  }

  async createMaintenance(input: NewMaintenance): Promise<Maintenance> {
    const start = dateMs(input.scheduledStart, "scheduledStart");
    const end = dateMs(input.scheduledEnd, "scheduledEnd");
    if (end <= start)
      throw new Error("Maintenance scheduledEnd must be after scheduledStart.");
    const now = new Date();
    const status = maintenanceAt(start, end, now.getTime());
    const id = createId("mnt");
    const monitors = names(input.affectedMonitors, "Affected monitor");
    await this.run(
      "INSERT INTO maintenance_windows (id, title, description, affected_monitors, scheduled_start, scheduled_end, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        text(input.title, "Maintenance title"),
        input.description?.trim() ?? "",
        JSON.stringify(monitors),
        start,
        end,
        status,
        now.getTime(),
      ],
    );
    return {
      id,
      title: text(input.title, "Maintenance title"),
      description: input.description?.trim() ?? "",
      affectedMonitors: monitors,
      scheduledStart: new Date(start),
      scheduledEnd: new Date(end),
      status,
      createdAt: now,
    };
  }

  async listUpcoming(now = new Date()): Promise<Maintenance[]> {
    const at = dateMs(now, "now");
    await this.run(
      "UPDATE maintenance_windows SET status = 'completed' WHERE status != 'completed' AND scheduled_end <= ?",
      [at],
    );
    await this.run(
      "UPDATE maintenance_windows SET status = 'in-progress' WHERE status = 'scheduled' AND scheduled_start <= ? AND scheduled_end > ?",
      [at, at],
    );
    const rows = await this.all<Row>(
      "SELECT id, title, description, affected_monitors, scheduled_start, scheduled_end, status, created_at FROM maintenance_windows WHERE status != 'completed' ORDER BY scheduled_start, id",
    );
    return rows.map(maintenance);
  }

  async getMaintenance(id: string): Promise<Maintenance | null> {
    const row = (
      await this.all<Row>(
        `SELECT id, title, description, affected_monitors, scheduled_start,
                scheduled_end, status, created_at
         FROM maintenance_windows WHERE id = ?`,
        [id],
      )
    )[0];
    return row ? maintenance(row) : null;
  }

  async updateMaintenance(
    id: string,
    update: MaintenanceUpdate,
  ): Promise<Maintenance> {
    const next = mergeMaintenance(await this.requireMaintenance(id), update);
    await this.run(
      `UPDATE maintenance_windows
       SET title = ?, description = ?, affected_monitors = ?,
           scheduled_start = ?, scheduled_end = ?, status = ?
       WHERE id = ?`,
      [
        next.title,
        next.description,
        JSON.stringify(next.affectedMonitors),
        next.scheduledStart.getTime(),
        next.scheduledEnd.getTime(),
        next.status,
        id,
      ],
    );
    return next;
  }

  async deleteMaintenance(id: string): Promise<void> {
    await this.requireMaintenance(id);
    await this.run("DELETE FROM maintenance_windows WHERE id = ?", [id]);
  }

  private async requireMaintenance(id: string): Promise<Maintenance> {
    const window = await this.getMaintenance(id);
    if (!window) {
      throw new Error(
        `Maintenance window ${JSON.stringify(id)} was not found.`,
      );
    }
    return window;
  }

  async createSubscriber(input: NewSubscriber): Promise<Subscriber> {
    const type = subscriberType(input.type);
    const target = text(input.target, "Subscriber target");
    const confirmed = input.confirmed === true;
    const token = confirmed
      ? null
      : text(input.confirmToken ?? "", "Subscriber confirmToken");
    const monitors =
      input.monitors === undefined || input.monitors === null
        ? null
        : names(input.monitors, "Subscriber monitor");
    const createdAt = new Date();
    const id = createId("sub");
    await this.run(
      "INSERT INTO subscribers (id, type, target, confirmed, confirm_token, monitors, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        type,
        target,
        confirmed ? 1 : 0,
        token,
        monitors === null ? null : JSON.stringify(monitors),
        createdAt.getTime(),
      ],
    );
    return { id, type, target, confirmed, monitors, createdAt };
  }

  async confirmSubscriber(token: string): Promise<Subscriber | null> {
    const rows = await this.all<Row>(
      "SELECT id, type, target, confirmed, monitors, created_at FROM subscribers WHERE confirm_token = ?",
      [text(token, "Subscriber confirmation token")],
    );
    const row = rows[0];
    if (!row) return null;
    await this.run(
      "UPDATE subscribers SET confirmed = 1, confirm_token = NULL WHERE id = ?",
      [string(row.id)],
    );
    return { ...subscriber(row), confirmed: true };
  }

  async listSubscribers(
    options: SubscriberListOptions = {},
  ): Promise<Subscriber[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (options.type) {
      conditions.push("type = ?");
      values.push(subscriberType(options.type));
    }
    if (options.confirmed !== undefined) {
      conditions.push("confirmed = ?");
      values.push(options.confirmed ? 1 : 0);
    }
    return (
      await this.all<Row>(
        `SELECT id, type, target, confirmed, monitors, created_at FROM subscribers ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY created_at, id`,
        values,
      )
    ).map(subscriber);
  }

  async deleteSubscriber(id: string): Promise<boolean> {
    const rows = await this.all<Row>(
      "SELECT id FROM subscribers WHERE id = ?",
      [text(id, "Subscriber id")],
    );
    if (!rows[0]) return false;
    await this.run("DELETE FROM subscribers WHERE id = ?", [id]);
    return true;
  }

  async recordNotification(
    input: NewNotificationLog,
  ): Promise<NotificationLog> {
    const createdAt = input.createdAt ? date(input.createdAt) : new Date();
    const id = createId("ntf");
    const attempts = input.attempts ?? 1;
    if (!Number.isSafeInteger(attempts) || attempts < 1)
      throw new Error("Notification attempts must be a positive integer.");
    const result: NotificationLog = {
      id,
      channelId: text(input.channelId, "Notification channelId"),
      channelType: notificationType(input.channelType),
      eventType: eventType(input.eventType),
      status: deliveryStatus(input.status),
      attempts,
      error: input.error ?? null,
      monitorName: input.monitorName ?? null,
      incidentId: input.incidentId ?? null,
      maintenanceId: input.maintenanceId ?? null,
      createdAt,
    };
    await this.run(
      "INSERT INTO notification_log (id, channel_id, channel_type, event_type, status, attempts, error, monitor_name, incident_id, maintenance_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        result.id,
        result.channelId,
        result.channelType,
        result.eventType,
        result.status,
        result.attempts,
        result.error,
        result.monitorName,
        result.incidentId,
        result.maintenanceId,
        result.createdAt.getTime(),
      ],
    );
    return result;
  }

  async listNotificationLog(
    options: NotificationLogOptions = {},
  ): Promise<NotificationLog[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (options.channelId) {
      conditions.push("channel_id = ?");
      values.push(options.channelId);
    }
    addIn(
      conditions,
      values,
      "event_type",
      list(options.eventType).map(eventType),
    );
    addIn(
      conditions,
      values,
      "status",
      list(options.status).map(deliveryStatus),
    );
    let sql = `SELECT id, channel_id, channel_type, event_type, status, attempts, error, monitor_name, incident_id, maintenance_id, created_at FROM notification_log ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY created_at DESC, id DESC`;
    if (options.limit !== undefined) {
      sql += " LIMIT ?";
      values.push(page(options.limit));
      if (options.offset !== undefined) {
        sql += " OFFSET ?";
        values.push(page(options.offset));
      }
    } else if (options.offset !== undefined) {
      sql += " LIMIT -1 OFFSET ?";
      values.push(page(options.offset));
    }
    return (await this.all<Row>(sql, values)).map(notification);
  }
}

/** Creates a D1 adapter. Apply the published SQL migrations with Wrangler before deployment. */
export function d1(
  binding: D1Database,
  options?: D1StatusDatabaseOptions,
): D1StatusDatabase {
  return new D1StatusDatabase(binding, options);
}

function compact(results: CheckResult[]): DailySummary[] {
  const buckets = new Map<string, CheckResult[]>();
  for (const result of results) {
    const start = utcDay(result.checkedAt).getTime();
    const key = `${result.name}\0${start}`;
    buckets.get(key)?.push(result) ?? buckets.set(key, [result]);
  }
  return [...buckets.values()].map((rows) => {
    const first = rows[0]!;
    const start = utcDay(first.checkedAt).getTime();
    let down = 0;
    let downMs = 0;
    let total = 0;
    let min: number | null = null;
    let max: number | null = null;
    for (const [index, row] of rows.entries()) {
      const latency = Math.max(0, row.latencyMs);
      total += latency;
      min = min === null ? latency : Math.min(min, latency);
      max = max === null ? latency : Math.max(max, latency);
      if (!row.status) {
        down += 1;
        downMs += Math.max(
          0,
          Math.min(
            rows[index + 1]?.checkedAt.getTime() ?? start + dayMs,
            start + dayMs,
          ) - row.checkedAt.getTime(),
        );
      }
    }
    const latest = rows.at(-1)!;
    return {
      name: first.name,
      dayStartAt: new Date(start),
      totalChecks: rows.length,
      downChecks: down,
      downMinutes: Math.ceil(downMs / minuteMs),
      totalLatencyMs: total,
      minLatencyMs: min,
      maxLatencyMs: max,
      latestStatus: latest.status,
      latestCheckedAt: latest.checkedAt,
    };
  });
}
function checkResult(row: Row): CheckResult {
  return {
    name: string(row.name),
    type: string(row.type) as StatusMonitorConfig["type"],
    status: number(row.status) === 1,
    message: row.message === null ? "" : string(row.message),
    latencyMs: number(row.latency_ms),
    checkedAt: date(row.created_at),
  };
}
function summary(row: Row): DailySummary {
  return {
    name: string(row.name),
    dayStartAt: date(row.day_start_at),
    totalChecks: number(row.total_checks),
    downChecks: number(row.down_checks),
    downMinutes: number(row.down_minutes),
    totalLatencyMs: number(row.total_latency_ms),
    minLatencyMs:
      row.min_latency_ms === null ? null : number(row.min_latency_ms),
    maxLatencyMs:
      row.max_latency_ms === null ? null : number(row.max_latency_ms),
    latestStatus: number(row.latest_status) === 1,
    latestCheckedAt: date(row.latest_checked_at),
  };
}
function maintenance(row: Row): Maintenance {
  return {
    id: string(row.id),
    title: string(row.title),
    description: string(row.description),
    affectedMonitors: jsonNames(row.affected_monitors),
    scheduledStart: date(row.scheduled_start),
    scheduledEnd: date(row.scheduled_end),
    status: maintenanceStatus(string(row.status)),
    createdAt: date(row.created_at),
  };
}
function subscriber(row: Row): Subscriber {
  return {
    id: string(row.id),
    type: subscriberType(string(row.type)),
    target: string(row.target),
    confirmed: number(row.confirmed) === 1,
    monitors: row.monitors === null ? null : jsonNames(row.monitors),
    createdAt: date(row.created_at),
  };
}
function notification(row: Row): NotificationLog {
  return {
    id: string(row.id),
    channelId: string(row.channel_id),
    channelType: notificationType(string(row.channel_type)),
    eventType: eventType(string(row.event_type)),
    status: deliveryStatus(string(row.status)),
    attempts: number(row.attempts),
    error: row.error === null ? null : string(row.error),
    monitorName: row.monitor_name === null ? null : string(row.monitor_name),
    incidentId: row.incident_id === null ? null : string(row.incident_id),
    maintenanceId:
      row.maintenance_id === null ? null : string(row.maintenance_id),
    createdAt: date(row.created_at),
  };
}
function addIn(
  conditions: string[],
  values: unknown[],
  column: string,
  items: string[],
): void {
  if (items.length) {
    conditions.push(`${column} IN (${items.map(() => "?").join(", ")})`);
    values.push(...items);
  }
}
function list<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}
function utcDay(value: Date): Date {
  return new Date(Math.floor(dateMs(value, "date") / dayMs) * dayMs);
}
function date(value: unknown): Date {
  const result = new Date(number(value));
  if (!Number.isFinite(result.getTime()))
    throw new Error("Database returned an invalid timestamp.");
  return result;
}
function dateMs(value: Date, name: string): number {
  if (!Number.isFinite(value.getTime()))
    throw new Error(`${name} must be a valid Date.`);
  return value.getTime();
}
function number(value: unknown): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(result))
    throw new Error("Database returned an invalid number.");
  return result;
}
function string(value: unknown): string {
  if (typeof value !== "string")
    throw new Error("Database returned an invalid string.");
  return value;
}
function text(value: string, name: string): string {
  const result = value.trim();
  if (!result) throw new Error(`${name} cannot be empty.`);
  return result;
}
function names(value: string[], name: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${name}s must be an array.`);
  return [...new Set(value.map((item) => text(item, name)))];
}
function jsonNames(value: unknown): string[] {
  try {
    const parsed: unknown = JSON.parse(string(value));
    return Array.isArray(parsed) &&
      parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}
function positive(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer.`);
}
function page(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Pagination must be a non-negative integer.");
  return value;
}
function incidentStatus(value: string): IncidentStatus {
  if (!incidentStatuses.has(value as IncidentStatus))
    throw new Error(`Unsupported incident status: ${JSON.stringify(value)}.`);
  return value as IncidentStatus;
}
function severity(value: string): IncidentSeverity {
  if (!incidentSeverities.has(value as IncidentSeverity))
    throw new Error(`Unsupported incident severity: ${JSON.stringify(value)}.`);
  return value as IncidentSeverity;
}
function maintenanceStatus(value: string): MaintenanceStatus {
  if (!maintenanceStatuses.has(value as MaintenanceStatus))
    throw new Error(
      `Unsupported maintenance status: ${JSON.stringify(value)}.`,
    );
  return value as MaintenanceStatus;
}
function maintenanceAt(
  start: number,
  end: number,
  now: number,
): MaintenanceStatus {
  return end <= now ? "completed" : start <= now ? "in-progress" : "scheduled";
}
function subscriberType(value: string): SubscriberType {
  if (!subscriberTypes.has(value as SubscriberType))
    throw new Error(`Unsupported subscriber type: ${JSON.stringify(value)}.`);
  return value as SubscriberType;
}
function notificationType(value: string): NotificationChannelType {
  if (!notificationTypes.has(value as NotificationChannelType))
    throw new Error(
      `Unsupported notification channel type: ${JSON.stringify(value)}.`,
    );
  return value as NotificationChannelType;
}
function deliveryStatus(value: string): NotificationDeliveryStatus {
  if (!deliveryStatuses.has(value as NotificationDeliveryStatus))
    throw new Error(
      `Unsupported notification delivery status: ${JSON.stringify(value)}.`,
    );
  return value as NotificationDeliveryStatus;
}
function eventType(value: string): import("../types").StatusEventType {
  if (!eventTypes.has(value))
    throw new Error(
      `Unsupported notification event type: ${JSON.stringify(value)}.`,
    );
  return value as import("../types").StatusEventType;
}
