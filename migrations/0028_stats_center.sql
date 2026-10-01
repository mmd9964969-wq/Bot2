-- Capability: Unified Advanced Stats Center
-- Persistent aggregation, hourly analytics and direct interaction graph.

ALTER TABLE bot_message_records
  ADD COLUMN IF NOT EXISTS reply_to_user_id BIGINT,
  ADD COLUMN IF NOT EXISTS reply_to_message_id BIGINT;

CREATE TABLE IF NOT EXISTS stats_processed_messages(
  chat_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(chat_id,message_id)
);

CREATE TABLE IF NOT EXISTS stats_user_daily(
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  day DATE NOT NULL,
  messages INTEGER NOT NULL DEFAULT 0,
  links INTEGER NOT NULL DEFAULT 0,
  text_count INTEGER NOT NULL DEFAULT 0,
  photo_count INTEGER NOT NULL DEFAULT 0,
  video_count INTEGER NOT NULL DEFAULT 0,
  audio_count INTEGER NOT NULL DEFAULT 0,
  document_count INTEGER NOT NULL DEFAULT 0,
  animation_count INTEGER NOT NULL DEFAULT 0,
  sticker_count INTEGER NOT NULL DEFAULT 0,
  voice_count INTEGER NOT NULL DEFAULT 0,
  video_note_count INTEGER NOT NULL DEFAULT 0,
  other_count INTEGER NOT NULL DEFAULT 0,
  reply_sent_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(group_id,user_id,day)
);

CREATE TABLE IF NOT EXISTS stats_group_daily(
  group_id BIGINT NOT NULL,
  day DATE NOT NULL,
  messages INTEGER NOT NULL DEFAULT 0,
  links INTEGER NOT NULL DEFAULT 0,
  media INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  active_users INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(group_id,day)
);

CREATE TABLE IF NOT EXISTS stats_group_hourly(
  group_id BIGINT NOT NULL,
  day DATE NOT NULL,
  hour SMALLINT NOT NULL CHECK(hour BETWEEN 0 AND 23),
  message_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(group_id,day,hour)
);

CREATE TABLE IF NOT EXISTS stats_user_hourly(
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  day DATE NOT NULL,
  hour SMALLINT NOT NULL CHECK(hour BETWEEN 0 AND 23),
  message_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(group_id,user_id,day,hour)
);

CREATE TABLE IF NOT EXISTS stats_interactions_daily(
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  target_user_id BIGINT NOT NULL,
  day DATE NOT NULL,
  interaction_count INTEGER NOT NULL DEFAULT 0,
  last_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(group_id,user_id,target_user_id,day)
);

CREATE INDEX IF NOT EXISTS idx_stats_user_daily_period
  ON stats_user_daily(group_id,day,user_id);

CREATE INDEX IF NOT EXISTS idx_stats_group_daily_period
  ON stats_group_daily(group_id,day);

CREATE INDEX IF NOT EXISTS idx_stats_group_hourly_period
  ON stats_group_hourly(group_id,day,hour);

CREATE INDEX IF NOT EXISTS idx_stats_user_hourly_period
  ON stats_user_hourly(group_id,user_id,day,hour);

CREATE INDEX IF NOT EXISTS idx_stats_interactions_period
  ON stats_interactions_daily(group_id,day,user_id,target_user_id);

CREATE INDEX IF NOT EXISTS idx_stats_interactions_target
  ON stats_interactions_daily(group_id,target_user_id,day,user_id);
