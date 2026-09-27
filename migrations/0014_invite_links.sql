CREATE TABLE IF NOT EXISTS group_invite_links (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  telegram_invite_link TEXT NOT NULL UNIQUE,
  name TEXT,
  type TEXT NOT NULL DEFAULT 'normal',
  creator_user_id BIGINT,
  creator_username TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
  is_expired BOOLEAN NOT NULL DEFAULT FALSE,
  is_consumed BOOLEAN NOT NULL DEFAULT FALSE,
  is_one_time BOOLEAN NOT NULL DEFAULT FALSE,
  member_limit INTEGER,
  usage_count INTEGER NOT NULL DEFAULT 0,
  expire_at TIMESTAMPTZ,
  creates_join_request BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_group_invite_links_group ON group_invite_links(group_id);
CREATE INDEX IF NOT EXISTS idx_group_invite_links_group_active ON group_invite_links(group_id,is_active);
CREATE INDEX IF NOT EXISTS idx_group_invite_links_creator ON group_invite_links(group_id,creator_user_id);
CREATE INDEX IF NOT EXISTS idx_group_invite_links_created ON group_invite_links(group_id,created_at);
CREATE INDEX IF NOT EXISTS idx_group_invite_links_link ON group_invite_links(telegram_invite_link);

CREATE TABLE IF NOT EXISTS invite_link_events (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  invite_link_id BIGINT REFERENCES group_invite_links(id) ON DELETE CASCADE,
  actor_user_id BIGINT,
  event_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invite_link_events_group ON invite_link_events(group_id,created_at);
CREATE INDEX IF NOT EXISTS idx_invite_link_events_link ON invite_link_events(invite_link_id,created_at);

CREATE TABLE IF NOT EXISTS invite_link_join_requests (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  invite_link_id BIGINT REFERENCES group_invite_links(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  username TEXT,
  first_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  processed_by BIGINT,
  UNIQUE(invite_link_id,user_id)
);

CREATE INDEX IF NOT EXISTS idx_invite_link_requests_group ON invite_link_join_requests(group_id,status,requested_at);
CREATE INDEX IF NOT EXISTS idx_invite_link_requests_link ON invite_link_join_requests(invite_link_id,status);

CREATE TABLE IF NOT EXISTS invite_link_flows (
  user_id BIGINT NOT NULL,
  group_id BIGINT NOT NULL,
  state TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  message_id BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(user_id,group_id)
);
