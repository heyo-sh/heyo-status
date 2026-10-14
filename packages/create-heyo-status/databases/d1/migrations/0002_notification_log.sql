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
