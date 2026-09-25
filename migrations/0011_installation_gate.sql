-- Capability 14 · Installation Gate & Response Policy
CREATE TABLE IF NOT EXISTS bot_group_installations (
  group_id BIGINT PRIMARY KEY,
  installed BOOLEAN NOT NULL DEFAULT FALSE,
  installed_at TIMESTAMPTZ,
  installed_by BIGINT,
  uninstalled_at TIMESTAMPTZ,
  uninstalled_by BIGINT,
  installation_version TEXT NOT NULL DEFAULT 'v1.0.0',
  bot_permission_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_policy TEXT NOT NULL DEFAULT 'standard',
  member_message_policy TEXT NOT NULL DEFAULT 'silent',
  command_policy TEXT NOT NULL DEFAULT 'enabled',
  command_mode TEXT NOT NULL DEFAULT 'plain',
  automation_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  security_mode TEXT NOT NULL DEFAULT 'standard',
  audit_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS bot_installation_events (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  actor_id BIGINT,
  event_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bot_installation_events_group_time ON bot_installation_events(group_id,created_at DESC);
