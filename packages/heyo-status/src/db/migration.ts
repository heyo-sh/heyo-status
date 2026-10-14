/**
 * Initial SQLite schema. The matching SQL file is published for operators and
 * this string lets the embedded Bun adapter migrate without filesystem access.
 */
export const initialMigrationId = "0000_initial";

export const initialMigrationSql = `
CREATE TABLE IF NOT EXISTS status_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  status INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_status_results_name_created
  ON status_results(name, created_at);

CREATE TABLE IF NOT EXISTS status_daily_summaries (
  name TEXT NOT NULL,
  day_start_at INTEGER NOT NULL,
  total_checks INTEGER NOT NULL,
  down_checks INTEGER NOT NULL,
  down_minutes INTEGER NOT NULL,
  total_latency_ms INTEGER NOT NULL DEFAULT 0,
  min_latency_ms INTEGER,
  max_latency_ms INTEGER,
  latest_status INTEGER NOT NULL,
  latest_checked_at INTEGER NOT NULL,
  PRIMARY KEY (name, day_start_at)
);
CREATE INDEX IF NOT EXISTS idx_summaries_day
  ON status_daily_summaries(day_start_at);
`;

/** Stage-5 incident and maintenance persistence. Kept separate for upgrades. */
export const incidentsMaintenanceMigrationId = "0001_incidents_maintenance";

export const incidentsMaintenanceMigrationSql = `
CREATE TABLE IF NOT EXISTS incidents (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  status            TEXT NOT NULL,
  severity          TEXT NOT NULL,
  affected_monitors TEXT NOT NULL,
  auto              INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  resolved_at       INTEGER,
  deleted_at        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_created ON incidents(created_at DESC);

CREATE TABLE IF NOT EXISTS incident_updates (
  id          TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  status      TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_incident_updates_incident
  ON incident_updates(incident_id, created_at);

CREATE TABLE IF NOT EXISTS maintenance_windows (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  affected_monitors TEXT NOT NULL,
  scheduled_start   INTEGER NOT NULL,
  scheduled_end     INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'scheduled',
  created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_maintenance_status
  ON maintenance_windows(status, scheduled_start);
`;

/** Stage-6 delivery history. Channel credentials and raw payloads are excluded. */
export const notificationLogMigrationId = "0002_notification_log";

export const notificationLogMigrationSql = `
CREATE TABLE IF NOT EXISTS notification_log (
  id             TEXT PRIMARY KEY,
  channel_id     TEXT NOT NULL,
  channel_type   TEXT NOT NULL,
  event_type     TEXT NOT NULL,
  status         TEXT NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 1,
  error          TEXT,
  monitor_name   TEXT,
  incident_id    TEXT,
  maintenance_id TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notification_log_created
  ON notification_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_log_channel_created
  ON notification_log(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_log_event_created
  ON notification_log(event_type, created_at DESC);
`;

/** Stage-7 public email and webhook subscriptions. */
export const subscribersMigrationId = "0003_subscribers";

export const subscribersMigrationSql = `
CREATE TABLE IF NOT EXISTS subscribers (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  target        TEXT NOT NULL,
  confirmed     INTEGER NOT NULL DEFAULT 0,
  confirm_token TEXT,
  monitors      TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscribers_type_confirmed
  ON subscribers(type, confirmed);
CREATE INDEX IF NOT EXISTS idx_subscribers_confirm_token
  ON subscribers(confirm_token);
`;

/**
 * One subscription per destination.
 *
 * `POST /subscribers` is public, so without this a retry, a double-clicked
 * button or two concurrent requests each created a row: the address was mailed
 * again for every one of them, and then received one copy of every incident per
 * duplicate. The API already de-duplicates, but only the index can settle a
 * race between two requests.
 */
export const subscriberUniquenessMigrationId = "0004_subscriber_uniqueness";

export const subscriberUniquenessMigrationSql = `
DELETE FROM subscribers
WHERE id NOT IN (SELECT MIN(id) FROM subscribers GROUP BY type, target);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscribers_destination
  ON subscribers(type, target);
`;
