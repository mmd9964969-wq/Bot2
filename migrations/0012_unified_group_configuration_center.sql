-- Capability 13 · Unified Group Configuration Center
CREATE TABLE IF NOT EXISTS bot_group_configuration (
  group_id BIGINT PRIMARY KEY,
  system_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  system_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  command_prefix TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'Asia/Tehran',
  quiet_mode_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  quiet_start TEXT NOT NULL DEFAULT '23:00',
  quiet_end TEXT NOT NULL DEFAULT '07:00',
  default_message TEXT NOT NULL DEFAULT '',
  report_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  daily_report_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  report_target_chat_id BIGINT,
  membership_verification BOOLEAN NOT NULL DEFAULT FALSE,
  rules_text TEXT NOT NULL DEFAULT '',
  stats_retention_days INTEGER NOT NULL DEFAULT 90 CHECK (stats_retention_days BETWEEN 1 AND 3650),
  forbidden_words JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_commands_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  welcome_button JSONB NOT NULL DEFAULT '{}'::jsonb,
  welcome_media JSONB NOT NULL DEFAULT '{}'::jsonb,
  goodbye_media JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bot_group_config_backups (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  created_by BIGINT NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_config_backups_group
  ON bot_group_config_backups(group_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bot_group_settings (
  group_id BIGINT PRIMARY KEY,
  full_lock BOOLEAN NOT NULL DEFAULT FALSE,
  invite_protection BOOLEAN NOT NULL DEFAULT FALSE,
  fake_account_restriction BOOLEAN NOT NULL DEFAULT FALSE,
  new_account_days INTEGER NOT NULL DEFAULT 0,
  emergency_mode BOOLEAN NOT NULL DEFAULT FALSE,
  welcome_text TEXT NOT NULL DEFAULT '',
  goodbye_text TEXT NOT NULL DEFAULT '',
  welcome_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  rules_on_join BOOLEAN NOT NULL DEFAULT FALSE,
  pv_welcome BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE bot_group_settings ADD COLUMN IF NOT EXISTS full_lock BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bot_group_settings ADD COLUMN IF NOT EXISTS invite_protection BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bot_group_settings ADD COLUMN IF NOT EXISTS fake_account_restriction BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bot_group_settings ADD COLUMN IF NOT EXISTS new_account_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bot_group_settings ADD COLUMN IF NOT EXISTS emergency_mode BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bot_group_settings ADD COLUMN IF NOT EXISTS welcome_text TEXT NOT NULL DEFAULT '';
ALTER TABLE bot_group_settings ADD COLUMN IF NOT EXISTS goodbye_text TEXT NOT NULL DEFAULT '';
ALTER TABLE bot_group_settings ADD COLUMN IF NOT EXISTS welcome_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE bot_group_settings ADD COLUMN IF NOT EXISTS rules_on_join BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bot_group_settings ADD COLUMN IF NOT EXISTS pv_welcome BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bot_group_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
