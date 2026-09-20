CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  telegram_id BIGINT UNIQUE,
  username TEXT,
  first_name TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  language TEXT NOT NULL DEFAULT 'fa',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commands (
  id BIGSERIAL PRIMARY KEY,
  command_key TEXT NOT NULL UNIQUE,
  fa_name TEXT,
  en_name TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  permission_level INTEGER NOT NULL DEFAULT 10,
  response_fa TEXT,
  response_en TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS command_permissions (
  command_id BIGINT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (command_id, role)
);
CREATE INDEX IF NOT EXISTS idx_command_permissions_role ON command_permissions(role);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  before_data JSONB,
  after_data JSONB,
  source TEXT NOT NULL DEFAULT 'panel',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'panel',
  last_sync_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO sync_state (id, source)
VALUES (1, 'panel')
ON CONFLICT (id) DO NOTHING;


-- Granular Permission Engine
CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role, permission_key)
);

INSERT INTO role_permissions (role, permission_key, allowed) VALUES
('OWNER','view',TRUE),('OWNER','create',TRUE),('OWNER','edit',TRUE),('OWNER','delete',TRUE),('OWNER','manage',TRUE),('OWNER','configure',TRUE),('OWNER','execute',TRUE),('OWNER','sync',TRUE),
('SUPER_ADMIN','view',TRUE),('SUPER_ADMIN','create',TRUE),('SUPER_ADMIN','edit',TRUE),('SUPER_ADMIN','delete',TRUE),('SUPER_ADMIN','manage',TRUE),('SUPER_ADMIN','configure',TRUE),('SUPER_ADMIN','execute',TRUE),('SUPER_ADMIN','sync',TRUE),
('ADMIN','view',TRUE),('ADMIN','create',TRUE),('ADMIN','edit',TRUE),('ADMIN','delete',FALSE),('ADMIN','manage',TRUE),('ADMIN','configure',TRUE),('ADMIN','execute',TRUE),('ADMIN','sync',FALSE),
('MODERATOR','view',TRUE),('MODERATOR','create',FALSE),('MODERATOR','edit',TRUE),('MODERATOR','delete',FALSE),('MODERATOR','manage',TRUE),('MODERATOR','configure',FALSE),('MODERATOR','execute',TRUE),('MODERATOR','sync',FALSE),
('SPECIAL_USER','view',TRUE),('SPECIAL_USER','create',FALSE),('SPECIAL_USER','edit',FALSE),('SPECIAL_USER','delete',FALSE),('SPECIAL_USER','manage',FALSE),('SPECIAL_USER','configure',FALSE),('SPECIAL_USER','execute',TRUE),('SPECIAL_USER','sync',FALSE),
('MEMBER','view',TRUE),('MEMBER','create',FALSE),('MEMBER','edit',FALSE),('MEMBER','delete',FALSE),('MEMBER','manage',FALSE),('MEMBER','configure',FALSE),('MEMBER','execute',FALSE),('MEMBER','sync',FALSE)
ON CONFLICT (role, permission_key) DO NOTHING;


-- Supervision Center / Event Engine
CREATE TABLE IF NOT EXISTS supervision_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  actor_id TEXT,
  target_type TEXT,
  target_id TEXT,
  command_key TEXT,
  group_id BIGINT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_supervision_events_created_at ON supervision_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supervision_events_type ON supervision_events(event_type);
CREATE INDEX IF NOT EXISTS idx_supervision_events_actor ON supervision_events(actor_id);


-- Response Studio
CREATE TABLE IF NOT EXISTS response_templates (
  id BIGSERIAL PRIMARY KEY,
  response_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL DEFAULT 'custom',
  title TEXT NOT NULL DEFAULT '',
  message_fa TEXT NOT NULL DEFAULT '',
  message_en TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT 'group',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_response_templates_event_type ON response_templates(event_type);
CREATE INDEX IF NOT EXISTS idx_response_templates_enabled ON response_templates(enabled);


-- User-specific Permission Overrides
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, permission_key)
);
CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
