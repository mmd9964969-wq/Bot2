CREATE TABLE IF NOT EXISTS bot_member_profiles (
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  join_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_bot_member_profiles_group_joined
  ON bot_member_profiles(group_id, joined_at);

CREATE INDEX IF NOT EXISTS idx_bot_member_profiles_group_user
  ON bot_member_profiles(group_id, user_id);
