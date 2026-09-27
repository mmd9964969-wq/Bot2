CREATE TABLE IF NOT EXISTS bot_group_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES bot_customers(user_id) ON DELETE CASCADE,
  group_id BIGINT NOT NULL,
  group_title TEXT NOT NULL DEFAULT '',
  group_username TEXT,
  subscription_type TEXT NOT NULL,
  duration_days INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  warning_sent BOOLEAN NOT NULL DEFAULT FALSE,
  warning_message_id BIGINT,
  warning_sent_at TIMESTAMPTZ,
  created_by BIGINT NOT NULL,
  renewal_count INTEGER NOT NULL DEFAULT 0,
  last_renewed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bot_group_subscriptions_status_ck CHECK (status IN ('ACTIVE','EXPIRING','EXPIRED','LIFETIME','CANCELLED')),
  CONSTRAINT bot_group_subscriptions_type_ck CHECK (subscription_type IN ('daily','monthly','2_months','3_months','6_months','lifetime')),
  CONSTRAINT bot_group_subscriptions_duration_ck CHECK (duration_days IS NULL OR duration_days > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS bot_group_subscriptions_active_group_uidx ON bot_group_subscriptions(group_id) WHERE status IN ('ACTIVE','EXPIRING','LIFETIME');
CREATE INDEX IF NOT EXISTS bot_group_subscriptions_customer_idx ON bot_group_subscriptions(customer_id,status,expires_at);
CREATE INDEX IF NOT EXISTS bot_group_subscriptions_expiry_idx ON bot_group_subscriptions(status,expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS bot_group_subscriptions_group_customer_idx ON bot_group_subscriptions(group_id,customer_id);
CREATE INDEX IF NOT EXISTS bot_group_subscriptions_history_idx ON bot_group_subscriptions(created_at DESC);
