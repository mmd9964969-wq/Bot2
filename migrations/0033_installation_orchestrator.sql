-- Stage 8: Installation Orchestrator
-- Creates durable per-group capability, runtime and orchestration-migration state.
-- Existing installation data is intentionally preserved.

CREATE TABLE IF NOT EXISTS bot_installation_capabilities (
  group_id BIGINT NOT NULL,
  capability_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NOT_INSTALLED',
  version TEXT NOT NULL DEFAULT '1',
  dependencies JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  activated_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  failure_code TEXT,
  failure_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(group_id, capability_id)
);

CREATE TABLE IF NOT EXISTS bot_installation_runtime (
  group_id BIGINT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'DETACHED',
  version TEXT NOT NULL DEFAULT '',
  execution_id TEXT,
  attached_at TIMESTAMPTZ,
  detached_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bot_installation_orchestrator_migrations (
  group_id BIGINT NOT NULL,
  migration_id TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(group_id, migration_id)
);

CREATE INDEX IF NOT EXISTS idx_bot_installation_capabilities_group
  ON bot_installation_capabilities(group_id, status);

CREATE INDEX IF NOT EXISTS idx_bot_installation_runtime_status
  ON bot_installation_runtime(status, updated_at DESC);
