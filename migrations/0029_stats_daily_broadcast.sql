-- Daily Stats Center broadcast ledger
-- One automatic report per group and report day.
CREATE TABLE IF NOT EXISTS stats_daily_broadcast_log (
  group_id BIGINT NOT NULL,
  report_day DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, report_day)
);

CREATE INDEX IF NOT EXISTS idx_stats_daily_broadcast_log_day
  ON stats_daily_broadcast_log(report_day, status);
