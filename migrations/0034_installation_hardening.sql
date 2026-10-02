-- Installation system hardening: durable session state metadata and audit indexes.
ALTER TABLE bot_installation_sessions
  ADD COLUMN IF NOT EXISTS state_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE bot_installation_sessions
  ADD COLUMN IF NOT EXISTS last_action TEXT;

ALTER TABLE bot_installation_sessions
  ADD COLUMN IF NOT EXISTS last_error_code TEXT;

CREATE INDEX IF NOT EXISTS idx_bot_installation_sessions_actor_expiry
  ON bot_installation_sessions(actor_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_bot_installation_events_group_type_time
  ON bot_installation_events(group_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_installation_progress_group_status
  ON bot_installation_progress(group_id, status, updated_at DESC);
