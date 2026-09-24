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


-- Capability 12 · Advanced Warning & Penalty System
CREATE TABLE IF NOT EXISTS bot_groups (
  id BIGINT PRIMARY KEY,
  title TEXT,
  username TEXT,
  type TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS warning_system_settings (
  group_id BIGINT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  auto_expire_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  expire_after_days INTEGER NOT NULL DEFAULT 30 CHECK (expire_after_days BETWEEN 1 AND 3650),
  notify_private BOOLEAN NOT NULL DEFAULT FALSE,
  exempt_admins BOOLEAN NOT NULL DEFAULT TRUE,
  permanent_threshold INTEGER NOT NULL DEFAULT 5 CHECK (permanent_threshold BETWEEN 1 AND 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS warning_levels (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  level_no INTEGER NOT NULL CHECK (level_no BETWEEN 1 AND 5),
  name TEXT NOT NULL,
  warning_count_required INTEGER NOT NULL CHECK (warning_count_required BETWEEN 1 AND 100),
  penalty_type TEXT NOT NULL CHECK (penalty_type IN ('mute','restrict','temp_ban','permanent_ban')),
  duration_value INTEGER,
  duration_unit TEXT CHECK (duration_unit IS NULL OR duration_unit IN ('hours','days')),
  message_fa TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(group_id, level_no)
);
CREATE TABLE IF NOT EXISTS warning_cases (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  first_name TEXT,
  username TEXT,
  warning_count INTEGER NOT NULL DEFAULT 0,
  current_level INTEGER NOT NULL DEFAULT 0,
  last_violation_type TEXT,
  last_warning_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'cleared' CHECK (status IN ('active','penalized','cleared')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(group_id, user_id)
);
CREATE TABLE IF NOT EXISTS warning_events (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  first_name TEXT,
  username TEXT,
  action_type TEXT NOT NULL CHECK (action_type IN ('warning','penalty','clear')),
  violation_type TEXT,
  custom_violation TEXT,
  level_no INTEGER,
  message_fa TEXT,
  penalty_type TEXT,
  duration_value INTEGER,
  duration_unit TEXT,
  admin_id TEXT,
  admin_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  result TEXT NOT NULL DEFAULT 'queued',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS warning_penalties (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  event_id BIGINT REFERENCES warning_events(id) ON DELETE SET NULL,
  penalty_type TEXT NOT NULL CHECK (penalty_type IN ('mute','restrict','temp_ban','permanent_ban')),
  duration_value INTEGER,
  duration_unit TEXT CHECK (duration_unit IS NULL OR duration_unit IN ('hours','days')),
  reason TEXT,
  admin_id TEXT,
  admin_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS warning_action_queue (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  event_id BIGINT REFERENCES warning_events(id) ON DELETE CASCADE,
  penalty_id BIGINT REFERENCES warning_penalties(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('warning_notify','penalty_apply')),
  message TEXT,
  penalty_type TEXT,
  duration_value INTEGER,
  duration_unit TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_warning_levels_group ON warning_levels(group_id, level_no);
CREATE INDEX IF NOT EXISTS idx_warning_cases_group_status ON warning_cases(group_id, status);
CREATE INDEX IF NOT EXISTS idx_warning_events_group_user ON warning_events(group_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_warning_events_active ON warning_events(group_id, status, action_type);
CREATE INDEX IF NOT EXISTS idx_warning_penalties_group_user ON warning_penalties(group_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_warning_penalties_active ON warning_penalties(group_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_warning_queue_pending ON warning_action_queue(status, available_at, id);
CREATE INDEX IF NOT EXISTS idx_bot_groups_active ON bot_groups(is_active, updated_at DESC);
