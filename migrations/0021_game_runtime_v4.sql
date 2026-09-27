-- Game Center V4 · unified runtime, turns, score/cups and secure Mini App launch
ALTER TABLE game_players ADD COLUMN IF NOT EXISTS cups BIGINT NOT NULL DEFAULT 0 CHECK(cups>=0);
ALTER TABLE game_player_stats ADD COLUMN IF NOT EXISTS cups BIGINT NOT NULL DEFAULT 0 CHECK(cups>=0);
ALTER TABLE game_match_history ADD COLUMN IF NOT EXISTS score BIGINT NOT NULL DEFAULT 0;
ALTER TABLE game_match_history ADD COLUMN IF NOT EXISTS cup_delta INT NOT NULL DEFAULT 0;

ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'single';
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS room_id BIGINT;
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS turn_user_id BIGINT;
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS turn_no INT NOT NULL DEFAULT 0;
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS max_turns INT NOT NULL DEFAULT 0;
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS state JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS winner_id BIGINT;
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS score_limit BIGINT NOT NULL DEFAULT 5000;

ALTER TABLE game_results ADD COLUMN IF NOT EXISTS cups_earned BIGINT NOT NULL DEFAULT 0;
ALTER TABLE game_results ADD COLUMN IF NOT EXISTS turn_no INT;
ALTER TABLE game_results ADD COLUMN IF NOT EXISTS final_state JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_game_sessions_room_status ON game_sessions(room_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_sessions_turn ON game_sessions(group_id,turn_user_id,status);

CREATE TABLE IF NOT EXISTS game_session_players (
  session_id BIGINT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  slot INT NOT NULL,
  score BIGINT NOT NULL DEFAULT 0,
  cups BIGINT NOT NULL DEFAULT 0,
  connected BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(session_id,user_id),
  UNIQUE(session_id,slot)
);
ALTER TABLE game_session_players ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_game_session_players_user ON game_session_players(group_id,user_id,last_seen_at DESC);

CREATE TABLE IF NOT EXISTS game_session_moves (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  turn_no INT NOT NULL,
  action TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_game_session_moves_session ON game_session_moves(session_id,turn_no,id);

CREATE TABLE IF NOT EXISTS game_mini_launch_tokens (
  token UUID PRIMARY KEY,
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  game_code TEXT NOT NULL,
  room_id BIGINT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_game_mini_launch_tokens_lookup ON game_mini_launch_tokens(token,user_id,expires_at);

ALTER TABLE game_multiplayer_rooms ADD COLUMN IF NOT EXISTS session_id BIGINT REFERENCES game_sessions(id);
