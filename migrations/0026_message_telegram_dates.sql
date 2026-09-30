ALTER TABLE bot_message_records
  ADD COLUMN IF NOT EXISTS telegram_date BIGINT;

CREATE INDEX IF NOT EXISTS idx_bot_message_records_chat_user_telegram_date
  ON bot_message_records(chat_id,user_id,telegram_date DESC);
