-- Add redaction metadata to observations
ALTER TABLE observations ADD COLUMN redaction_meta TEXT;

-- Add index for querying by redaction status
CREATE INDEX IF NOT EXISTS idx_obs_redaction ON observations(redaction_meta) WHERE redaction_meta IS NOT NULL;

-- Add telemetry table for local metrics
CREATE TABLE IF NOT EXISTS telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric_type TEXT NOT NULL,
  metric_data TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_telemetry_type ON telemetry(metric_type);
CREATE INDEX IF NOT EXISTS idx_telemetry_created ON telemetry(created_at DESC);
