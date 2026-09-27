-- Game Center V2 · multiplayer foundation
CREATE TABLE IF NOT EXISTS game_multiplayer_matches (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  game_code TEXT NOT NULL,
  creator_id BIGINT NOT NULL,
  opponent_id BIGINT,
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting','active','finished','cancelled')),
  creator_roll INT,
  opponent_roll INT,
  winner_id BIGINT,
  creator_xp BIGINT NOT NULL DEFAULT 0,
  opponent_xp BIGINT NOT NULL DEFAULT 0,
  creator_gems BIGINT NOT NULL DEFAULT 0,
  opponent_gems BIGINT NOT NULL DEFAULT 0,
  creator_rating_delta INT NOT NULL DEFAULT 0,
  opponent_rating_delta INT NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_game_multi_waiting
  ON game_multiplayer_matches(group_id,game_code,status,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_game_multi_player
  ON game_multiplayer_matches(group_id,creator_id,opponent_id,created_at DESC);
