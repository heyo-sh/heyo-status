DELETE FROM subscribers
WHERE id NOT IN (SELECT MIN(id) FROM subscribers GROUP BY type, target);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscribers_destination
  ON subscribers(type, target);
