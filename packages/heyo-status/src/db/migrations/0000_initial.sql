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
