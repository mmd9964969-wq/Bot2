CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  telegram_id BIGINT UNIQUE,
  username TEXT,
  first_name TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  language TEXT NOT NULL DEFAULT 'fa',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commands (
  id BIGSERIAL PRIMARY KEY,
  command_key TEXT NOT NULL UNIQUE,
  fa_name TEXT,
  en_name TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  permission_level INTEGER NOT NULL DEFAULT 10,
  response_fa TEXT,
  response_en TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  before_data JSONB,
  after_data JSONB,
  source TEXT NOT NULL DEFAULT 'panel',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'panel',
  last_sync_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO sync_state (id, source)
VALUES (1, 'panel')
ON CONFLICT (id) DO NOTHING;


-- Granular Permission Engine
CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role, permission_key)
);

INSERT INTO role_permissions (role, permission_key, allowed) VALUES
('OWNER','view',TRUE),('OWNER','create',TRUE),('OWNER','edit',TRUE),('OWNER','delete',TRUE),('OWNER','manage',TRUE),('OWNER','configure',TRUE),('OWNER','execute',TRUE),('OWNER','sync',TRUE),
('SUPER_ADMIN','view',TRUE),('SUPER_ADMIN','create',TRUE),('SUPER_ADMIN','edit',TRUE),('SUPER_ADMIN','delete',TRUE),('SUPER_ADMIN','manage',TRUE),('SUPER_ADMIN','configure',TRUE),('SUPER_ADMIN','execute',TRUE),('SUPER_ADMIN','sync',TRUE),
('ADMIN','view',TRUE),('ADMIN','create',TRUE),('ADMIN','edit',TRUE),('ADMIN','delete',FALSE),('ADMIN','manage',TRUE),('ADMIN','configure',TRUE),('ADMIN','execute',TRUE),('ADMIN','sync',FALSE),
('MODERATOR','view',TRUE),('MODERATOR','create',FALSE),('MODERATOR','edit',TRUE),('MODERATOR','delete',FALSE),('MODERATOR','manage',TRUE),('MODERATOR','configure',FALSE),('MODERATOR','execute',TRUE),('MODERATOR','sync',FALSE),
('SPECIAL_USER','view',TRUE),('SPECIAL_USER','create',FALSE),('SPECIAL_USER','edit',FALSE),('SPECIAL_USER','delete',FALSE),('SPECIAL_USER','manage',FALSE),('SPECIAL_USER','configure',FALSE),('SPECIAL_USER','execute',TRUE),('SPECIAL_USER','sync',FALSE),
('MEMBER','view',TRUE),('MEMBER','create',FALSE),('MEMBER','edit',FALSE),('MEMBER','delete',FALSE),('MEMBER','manage',FALSE),('MEMBER','configure',FALSE),('MEMBER','execute',FALSE),('MEMBER','sync',FALSE)
ON CONFLICT (role, permission_key) DO NOTHING;
