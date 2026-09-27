-- Capability · Special Users Center
CREATE TABLE IF NOT EXISTS special_users (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  first_name TEXT,
  username TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','removed')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_by BIGINT NOT NULL,
  updated_by BIGINT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(group_id,user_id)
);
CREATE TABLE IF NOT EXISTS special_user_events (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('set','extend','reduce','remove','expire')),
  duration_seconds BIGINT,
  previous_expires_at TIMESTAMPTZ,
  new_expires_at TIMESTAMPTZ,
  actor_id BIGINT,
  actor_name TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_special_users_active ON special_users(group_id,status,expires_at);
CREATE INDEX IF NOT EXISTS idx_special_events_user ON special_user_events(group_id,user_id,created_at DESC);
