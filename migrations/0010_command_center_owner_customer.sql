CREATE TABLE IF NOT EXISTS bot_panel_owners (
  user_id BIGINT PRIMARY KEY,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS bot_customers (
  user_id BIGINT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  first_installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS bot_licenses (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  customer_id BIGINT NOT NULL REFERENCES bot_customers(user_id) ON DELETE CASCADE,
  license_type TEXT NOT NULL,
  group_limit INTEGER NOT NULL DEFAULT 1,
  price NUMERIC(18,2),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS bot_customer_groups (
  group_id BIGINT PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES bot_customers(user_id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS bot_blacklist (
  user_id BIGINT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS bot_system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS bot_broadcasts (
  id BIGSERIAL PRIMARY KEY,
  owner_id BIGINT NOT NULL,
  target_mode TEXT NOT NULL,
  source_chat_id BIGINT NOT NULL,
  source_message_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  total_targeted INTEGER NOT NULL DEFAULT 0,
  total_sent INTEGER NOT NULL DEFAULT 0,
  total_failed INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS bot_group_settings (
  group_id BIGINT PRIMARY KEY,
  welcome_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  goodbye_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  welcome_text TEXT NOT NULL DEFAULT 'خوش آمدید {{user_name}}؛ قوانین گروه را رعایت کنید.',
  goodbye_text TEXT NOT NULL DEFAULT '{{user_name}} از گروه خارج شد.',
  rules_on_join BOOLEAN NOT NULL DEFAULT FALSE,
  pv_welcome BOOLEAN NOT NULL DEFAULT FALSE,
  full_lock BOOLEAN NOT NULL DEFAULT FALSE,
  emergency_mode BOOLEAN NOT NULL DEFAULT FALSE,
  invite_protection BOOLEAN NOT NULL DEFAULT FALSE,
  fake_account_restriction BOOLEAN NOT NULL DEFAULT FALSE,
  new_account_days INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS bot_group_commands (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  command_key TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  response_text TEXT NOT NULL DEFAULT '',
  minimum_role TEXT NOT NULL DEFAULT 'MEMBER',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(group_id,command_key)
);
CREATE TABLE IF NOT EXISTS bot_schedules (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  creator_id BIGINT NOT NULL,
  message_text TEXT NOT NULL DEFAULT '',
  send_at TIMESTAMPTZ NOT NULL,
  repeat_seconds INTEGER,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bot_licenses_customer ON bot_licenses(customer_id,status,expires_at);
CREATE INDEX IF NOT EXISTS idx_bot_customer_groups_customer ON bot_customer_groups(customer_id,is_active);
CREATE INDEX IF NOT EXISTS idx_bot_schedules_due ON bot_schedules(enabled,send_at);
