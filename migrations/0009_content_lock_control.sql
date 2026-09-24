
CREATE TABLE IF NOT EXISTS content_lock_settings (
  group_id BIGINT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  exempt_admins BOOLEAN NOT NULL DEFAULT TRUE,
  notify_user BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS content_lock_rules (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  section TEXT NOT NULL,
  rule_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(group_id,rule_key)
);

CREATE TABLE IF NOT EXISTS content_lock_exceptions (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  exception_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_label TEXT NOT NULL DEFAULT '',
  scope JSONB NOT NULL DEFAULT '["all"]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(group_id,exception_type,target_id)
);

CREATE TABLE IF NOT EXISTS content_lock_domains (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  domain TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(group_id,domain)
);

CREATE TABLE IF NOT EXISTS content_lock_logs (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  message_id BIGINT,
  user_id BIGINT,
  username TEXT,
  first_name TEXT,
  content_type TEXT NOT NULL,
  rule_key TEXT NOT NULL,
  action TEXT NOT NULL,
  admin_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_lock_rules_group ON content_lock_rules(group_id,section,enabled);
CREATE INDEX IF NOT EXISTS idx_content_lock_exceptions_group ON content_lock_exceptions(group_id,enabled);
CREATE INDEX IF NOT EXISTS idx_content_lock_logs_group_time ON content_lock_logs(group_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_lock_logs_user ON content_lock_logs(group_id,user_id,created_at DESC);
