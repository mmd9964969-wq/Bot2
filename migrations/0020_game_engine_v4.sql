-- Game Center V4 · unified engine, turns, cups and Mini App sessions
ALTER TABLE game_players ADD COLUMN IF NOT EXISTS cups INT NOT NULL DEFAULT 0 CHECK(cups>=0);
ALTER TABLE game_player_stats ADD COLUMN IF NOT EXISTS cups BIGINT NOT NULL DEFAULT 0 CHECK(cups>=0);
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'solo';
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS current_turn_user_id BIGINT;
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS turn_no INT NOT NULL DEFAULT 0;
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS max_turns INT;
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS state JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS winner_id BIGINT;
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS ended_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_game_sessions_active_turn ON game_sessions(group_id,status,current_turn_user_id);
CREATE TABLE IF NOT EXISTS game_session_players (
  session_id BIGINT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  slot INT NOT NULL CHECK(slot BETWEEN 1 AND 10),
  ready BOOLEAN NOT NULL DEFAULT TRUE,
  score BIGINT NOT NULL DEFAULT 0,
  cups_delta INT NOT NULL DEFAULT 0,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  PRIMARY KEY(session_id,user_id),
  UNIQUE(session_id,slot)
);
CREATE INDEX IF NOT EXISTS idx_game_session_players_user ON game_session_players(group_id,user_id,joined_at DESC);
CREATE TABLE IF NOT EXISTS game_engine_events (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  group_id BIGINT NOT NULL,
  user_id BIGINT,
  turn_no INT,
  action TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_game_engine_events_session ON game_engine_events(session_id,created_at);
