CREATE TABLE IF NOT EXISTS agent_jobs (
  id BIGSERIAL PRIMARY KEY,
  requested_by TEXT NOT NULL,
  task_type TEXT NOT NULL,
  instruction TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','needs_owner','succeeded','failed','cancelled')),
  priority INTEGER NOT NULL DEFAULT 100,
  autopilot BOOLEAN NOT NULL DEFAULT FALSE,
  branch_name TEXT,
  commit_sha TEXT,
  deployment_id TEXT,
  changed_files JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT,
  error TEXT,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_jobs_queue
  ON agent_jobs(status, priority DESC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_agent_jobs_recent
  ON agent_jobs(created_at DESC);

CREATE TABLE IF NOT EXISTS agent_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  autopilot_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  autopilot_interval_minutes INTEGER NOT NULL DEFAULT 360,
  auto_deploy BOOLEAN NOT NULL DEFAULT TRUE,
  max_iterations INTEGER NOT NULL DEFAULT 24,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO agent_settings(id)
VALUES(TRUE)
ON CONFLICT(id) DO NOTHING;
