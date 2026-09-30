CREATE TABLE IF NOT EXISTS bot_member_join_events (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_member_join_events_group_time
  ON bot_member_join_events(group_id, joined_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_member_join_events_group_user
  ON bot_member_join_events(group_id, user_id, joined_at DESC);
