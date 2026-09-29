-- Usage counters for the silent anti-abuse limits. `key` is a license machineId, or '*' for the
-- global daily total; `period` is "h<hour number>" or "d<day number>".
CREATE TABLE IF NOT EXISTS usage (
  key TEXT NOT NULL,
  period TEXT NOT NULL,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (key, period)
);

CREATE INDEX IF NOT EXISTS usage_expires_at ON usage (expires_at);
