-- Game Center V3 · reusable online room/lobby layer
CREATE TABLE IF NOT EXISTS game_multiplayer_rooms (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  game_code TEXT NOT NULL,
  host_id BIGINT NOT NULL,
  max_players INT NOT NULL DEFAULT 2 CHECK(max_players BETWEEN 2 AND 10),
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK(status IN ('waiting','ready','active','finished','cancelled')),
  match_id BIGINT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS game_multiplayer_room_players (
  room_id BIGINT NOT NULL REFERENCES game_multiplayer_rooms(id) ON DELETE CASCADE,
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  slot INT NOT NULL CHECK(slot BETWEEN 1 AND 10),
  ready BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  PRIMARY KEY(room_id,user_id),
  UNIQUE(room_id,slot)
);

CREATE INDEX IF NOT EXISTS idx_game_rooms_group_status
  ON game_multiplayer_rooms(group_id,status,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_game_room_players_room
  ON game_multiplayer_room_players(room_id,slot);

CREATE INDEX IF NOT EXISTS idx_game_room_players_user
  ON game_multiplayer_room_players(group_id,user_id,joined_at DESC);

-- One active/waiting room per player inside a group.
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_room_players_active_group_user
  ON game_multiplayer_room_players(group_id,user_id)
  WHERE left_at IS NULL;

-- One open room per host inside a group.
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_rooms_open_host
  ON game_multiplayer_rooms(group_id,host_id)
  WHERE status IN ('waiting','ready','active');
