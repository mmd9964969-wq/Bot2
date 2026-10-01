CREATE TABLE IF NOT EXISTS owner_group_registry(
  group_id BIGINT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  username TEXT,
  chat_type TEXT NOT NULL DEFAULT 'supergroup',
  bot_status TEXT NOT NULL DEFAULT 'ACTIVE',
  telegram_status TEXT NOT NULL DEFAULT 'unknown',
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  member_count INTEGER NOT NULL DEFAULT 0,
  admin_count INTEGER NOT NULL DEFAULT 0,
  owner_name TEXT,
  bot_can_delete BOOLEAN NOT NULL DEFAULT FALSE,
  bot_can_restrict BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_owner_group_registry_status ON owner_group_registry(bot_status);
CREATE INDEX IF NOT EXISTS idx_owner_group_registry_activity ON owner_group_registry(last_activity_at DESC);

CREATE TABLE IF NOT EXISTS owner_group_audit(
  id BIGSERIAL PRIMARY KEY,
  owner_id BIGINT,
  group_id BIGINT,
  action TEXT NOT NULL,
  old_state TEXT,
  new_state TEXT,
  result TEXT NOT NULL DEFAULT 'SUCCESS',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_owner_group_audit_group_time ON owner_group_audit(group_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_owner_group_audit_owner_time ON owner_group_audit(owner_id,created_at DESC);
