-- 0006: persistent idempotency records (remediation 4.5, FR-06.8).
-- External operations (image generation, …) record their per-task outcome
-- so a Runner restart + continue NEVER re-bills the same operation.

CREATE TABLE IF NOT EXISTS idempotency_keys (
  op_key TEXT PRIMARY KEY,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
