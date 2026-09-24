-- Capability 12 · Advanced Warning & Penalty System
-- Persistent warning policy, cases, history, penalties and Bot Core action queue.

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