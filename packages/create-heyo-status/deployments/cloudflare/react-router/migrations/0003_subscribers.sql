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
