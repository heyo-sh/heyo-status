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
