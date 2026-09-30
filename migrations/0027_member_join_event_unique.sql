CREATE UNIQUE INDEX IF NOT EXISTS uq_bot_member_join_events_group_user_time
  ON bot_member_join_events(group_id,user_id,joined_at);
