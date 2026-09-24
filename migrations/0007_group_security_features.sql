CREATE TABLE IF NOT EXISTS group_security_settings (
  chat_id BIGINT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  mode TEXT NOT NULL DEFAULT 'standard',
  exempt_admins BOOLEAN NOT NULL DEFAULT TRUE,
  exempt_special_users BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT group_security_settings_mode_chk CHECK (mode IN ('standard','strict'))
);