CREATE TABLE IF NOT EXISTS cleanup_messages (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  user_id BIGINT,
  username TEXT,
  message_type TEXT NOT NULL DEFAULT 'text',
  has_link BOOLEAN NOT NULL DEFAULT FALSE,
  has_media BOOLEAN NOT NULL DEFAULT FALSE,
  has_bot BOOLEAN NOT NULL DEFAULT FALSE,
  content TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(group_id,message_id)
);
CREATE INDEX IF NOT EXISTS cleanup_messages_group_created_idx ON cleanup_messages(group_id,created_at DESC);
CREATE INDEX IF NOT EXISTS cleanup_messages_group_user_idx ON cleanup_messages(group_id,user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS cleanup_jobs (
  id BIGSERIAL PRIMARY KEY,
  job_key TEXT UNIQUE NOT NULL,
  group_id BIGINT NOT NULL,
  actor_id BIGINT NOT NULL,
  mode TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'preview',
  total_count INT NOT NULL DEFAULT 0,
  eligible_count INT NOT NULL DEFAULT 0,
  success_count INT NOT NULL DEFAULT 0,
  failure_count INT NOT NULL DEFAULT 0,
  skipped_count INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS cleanup_jobs_group_created_idx ON cleanup_jobs(group_id,created_at DESC);

CREATE TABLE IF NOT EXISTS cleanup_job_items (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES cleanup_jobs(id) ON DELETE CASCADE,
  message_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_code TEXT,
  error_text TEXT,
  UNIQUE(job_id,message_id)
);
CREATE INDEX IF NOT EXISTS cleanup_job_items_pending_idx ON cleanup_job_items(job_id,status);

CREATE TABLE IF NOT EXISTS cleanup_protected_messages (
  group_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  reason TEXT,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(group_id,message_id)
);

CREATE TABLE IF NOT EXISTS cleanup_rules (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cleanup_audit_log (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  actor_id BIGINT NOT NULL,
  action TEXT NOT NULL,
  job_id BIGINT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
