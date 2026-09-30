-- Repair cleanup v2 tables created by older versions.
ALTER TABLE cleanup_messages ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE cleanup_messages ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text';
ALTER TABLE cleanup_messages ADD COLUMN IF NOT EXISTS has_link BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cleanup_messages ADD COLUMN IF NOT EXISTS has_media BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cleanup_messages ADD COLUMN IF NOT EXISTS has_bot BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cleanup_messages ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE cleanup_messages ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS cleanup_messages_group_message_uidx
  ON cleanup_messages(group_id,message_id);

CREATE INDEX IF NOT EXISTS cleanup_messages_group_created_idx
  ON cleanup_messages(group_id,created_at DESC);

CREATE INDEX IF NOT EXISTS cleanup_messages_group_user_idx
  ON cleanup_messages(group_id,user_id,created_at DESC);