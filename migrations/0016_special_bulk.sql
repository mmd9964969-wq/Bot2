-- Capability · Bulk Special Users
CREATE TABLE IF NOT EXISTS special_bulk_operations (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  actor_id BIGINT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('set','extend','reduce','remove')),
  policy TEXT NOT NULL CHECK (policy IN ('replace','extend','skip')),
  requested_count INTEGER NOT NULL DEFAULT 0,
  resolved_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  duration_seconds BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS special_bulk_operation_items (
  id BIGSERIAL PRIMARY KEY,
  operation_id BIGINT NOT NULL REFERENCES special_bulk_operations(id) ON DELETE CASCADE,
  input_value TEXT NOT NULL,
  user_id BIGINT,
  status TEXT NOT NULL CHECK (status IN ('success','skipped','failed')),
  action_type TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_special_bulk_ops_group
  ON special_bulk_operations(group_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_special_bulk_items_op
  ON special_bulk_operation_items(operation_id, created_at);
