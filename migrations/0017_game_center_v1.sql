-- Game Center V1 · player architecture and progression foundation

CREATE TABLE IF NOT EXISTS game_players (
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  level INT NOT NULL DEFAULT 1,
  xp BIGINT NOT NULL DEFAULT 0 CHECK (xp >= 0),
  gems BIGINT NOT NULL DEFAULT 0 CHECK (gems >= 0),
  rating INT NOT NULL DEFAULT 1000 CHECK (rating >= 0),
  high_score INT NOT NULL DEFAULT 1000 CHECK (high_score >= 0),
  total_games INT NOT NULL DEFAULT 0 CHECK (total_games >= 0),
  wins INT NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses INT NOT NULL DEFAULT 0 CHECK (losses >= 0),
  current_streak INT NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
  best_streak INT NOT NULL DEFAULT 0 CHECK (best_streak >= 0),
  quiz_wins INT NOT NULL DEFAULT 0 CHECK (quiz_wins >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

ALTER TABLE game_players ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE game_players ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE game_players ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE game_players ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE game_players ADD COLUMN IF NOT EXISTS high_score INT NOT NULL DEFAULT 1000;

CREATE INDEX IF NOT EXISTS idx_game_players_group_rating
  ON game_players(group_id, rating DESC, user_id ASC);

CREATE INDEX IF NOT EXISTS idx_game_players_activity
  ON game_players(group_id, last_active_at DESC);

CREATE TABLE IF NOT EXISTS game_player_progression (
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  level INT NOT NULL DEFAULT 1 CHECK (level >= 1),
  xp BIGINT NOT NULL DEFAULT 0 CHECK (xp >= 0),
  total_xp BIGINT NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
  season_xp BIGINT NOT NULL DEFAULT 0 CHECK (season_xp >= 0),
  prestige INT NOT NULL DEFAULT 0 CHECK (prestige >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id, user_id) REFERENCES game_players(group_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS game_wallets (
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_earned BIGINT NOT NULL DEFAULT 0 CHECK (lifetime_earned >= 0),
  lifetime_spent BIGINT NOT NULL DEFAULT 0 CHECK (lifetime_spent >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id, user_id) REFERENCES game_players(group_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS game_wallet_ledger (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  transaction_type TEXT NOT NULL DEFAULT 'adjustment',
  delta BIGINT NOT NULL,
  balance_before BIGINT NOT NULL CHECK (balance_before >= 0),
  balance_after BIGINT NOT NULL CHECK (balance_after >= 0),
  reason TEXT NOT NULL,
  game_code TEXT,
  reference_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (group_id, user_id) REFERENCES game_players(group_id, user_id) ON DELETE CASCADE
);

ALTER TABLE game_wallet_ledger ADD COLUMN IF NOT EXISTS transaction_type TEXT NOT NULL DEFAULT 'adjustment';
ALTER TABLE game_wallet_ledger ADD COLUMN IF NOT EXISTS balance_before BIGINT;
ALTER TABLE game_wallet_ledger ADD COLUMN IF NOT EXISTS reference_id TEXT;
UPDATE game_wallet_ledger
SET balance_before = balance_after - delta
WHERE balance_before IS NULL;
ALTER TABLE game_wallet_ledger ALTER COLUMN balance_before SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_game_wallet_ledger_player
  ON game_wallet_ledger(group_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS game_player_stats (
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  total_games BIGINT NOT NULL DEFAULT 0 CHECK (total_games >= 0),
  wins BIGINT NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses BIGINT NOT NULL DEFAULT 0 CHECK (losses >= 0),
  draws BIGINT NOT NULL DEFAULT 0 CHECK (draws >= 0),
  total_score BIGINT NOT NULL DEFAULT 0,
  high_score BIGINT NOT NULL DEFAULT 0 CHECK (high_score >= 0),
  current_streak BIGINT NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
  best_streak BIGINT NOT NULL DEFAULT 0 CHECK (best_streak >= 0),
  total_xp_earned BIGINT NOT NULL DEFAULT 0 CHECK (total_xp_earned >= 0),
  total_gems_earned BIGINT NOT NULL DEFAULT 0 CHECK (total_gems_earned >= 0),
  total_gems_spent BIGINT NOT NULL DEFAULT 0 CHECK (total_gems_spent >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id, user_id) REFERENCES game_players(group_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS game_player_rating (
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  rating INT NOT NULL DEFAULT 1000 CHECK (rating >= 0),
  rank INT NOT NULL DEFAULT 1 CHECK (rank >= 1),
  league TEXT NOT NULL DEFAULT 'BRONZE',
  league_points INT NOT NULL DEFAULT 0 CHECK (league_points >= 0),
  season_rating INT NOT NULL DEFAULT 1000 CHECK (season_rating >= 0),
  season_rank INT NOT NULL DEFAULT 1 CHECK (season_rank >= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id, user_id) REFERENCES game_players(group_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS game_player_streaks (
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  current_streak INT NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
  best_streak INT NOT NULL DEFAULT 0 CHECK (best_streak >= 0),
  last_claim_date DATE,
  next_reward BIGINT NOT NULL DEFAULT 0 CHECK (next_reward >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id, user_id) REFERENCES game_players(group_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS game_sessions (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  game_code TEXT NOT NULL,
  creator_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting',
  players_count INT NOT NULL DEFAULT 1 CHECK (players_count >= 1),
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_game_sessions_group_status
  ON game_sessions(group_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS game_results (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  result TEXT NOT NULL,
  score BIGINT NOT NULL DEFAULT 0,
  xp_earned BIGINT NOT NULL DEFAULT 0,
  gems_earned BIGINT NOT NULL DEFAULT 0,
  rating_delta INT NOT NULL DEFAULT 0,
  position INT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_game_results_player
  ON game_results(group_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS game_rewards (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  reward_type TEXT NOT NULL,
  amount BIGINT NOT NULL DEFAULT 0 CHECK (amount >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(group_id, code)
);

CREATE TABLE IF NOT EXISTS game_player_rewards (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  reward_id BIGINT NOT NULL REFERENCES game_rewards(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'available',
  claimed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_game_player_rewards_player
  ON game_player_rewards(group_id, user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS game_activity_log (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  action TEXT NOT NULL,
  category TEXT NOT NULL,
  amount BIGINT,
  reference_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (group_id, user_id) REFERENCES game_players(group_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_game_activity_player
  ON game_activity_log(group_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS game_seasons (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  season_code TEXT NOT NULL,
  title TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(group_id, season_code)
);

CREATE TABLE IF NOT EXISTS game_player_seasons (
  season_id BIGINT NOT NULL REFERENCES game_seasons(id) ON DELETE CASCADE,
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  season_xp BIGINT NOT NULL DEFAULT 0 CHECK (season_xp >= 0),
  season_rating INT NOT NULL DEFAULT 1000 CHECK (season_rating >= 0),
  season_rank INT NOT NULL DEFAULT 1 CHECK (season_rank >= 1),
  season_games INT NOT NULL DEFAULT 0 CHECK (season_games >= 0),
  season_wins INT NOT NULL DEFAULT 0 CHECK (season_wins >= 0),
  rewards_claimed BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (season_id, user_id),
  FOREIGN KEY (group_id, user_id) REFERENCES game_players(group_id, user_id) ON DELETE CASCADE
);

-- Backfill the new read models from the existing player table.
INSERT INTO game_player_progression(group_id,user_id,level,xp,total_xp)
SELECT group_id,user_id,level,xp,xp FROM game_players
ON CONFLICT(group_id,user_id) DO UPDATE SET
  level=EXCLUDED.level,
  xp=EXCLUDED.xp,
  total_xp=GREATEST(game_player_progression.total_xp,EXCLUDED.total_xp),
  updated_at=NOW();

INSERT INTO game_wallets(group_id,user_id,balance,lifetime_earned,lifetime_spent)
SELECT
  p.group_id,
  p.user_id,
  p.gems,
  COALESCE(SUM(CASE WHEN l.delta > 0 THEN l.delta ELSE 0 END),0),
  COALESCE(SUM(CASE WHEN l.delta < 0 THEN ABS(l.delta) ELSE 0 END),0)
FROM game_players p
LEFT JOIN game_wallet_ledger l
  ON l.group_id=p.group_id AND l.user_id=p.user_id
GROUP BY p.group_id,p.user_id,p.gems
ON CONFLICT(group_id,user_id) DO UPDATE SET
  balance=EXCLUDED.balance,
  lifetime_earned=EXCLUDED.lifetime_earned,
  lifetime_spent=EXCLUDED.lifetime_spent,
  updated_at=NOW();

INSERT INTO game_player_stats(group_id,user_id,total_games,wins,losses,high_score,current_streak,best_streak)
SELECT group_id,user_id,total_games,wins,losses,high_score,current_streak,best_streak
FROM game_players
ON CONFLICT(group_id,user_id) DO UPDATE SET
  total_games=EXCLUDED.total_games,
  wins=EXCLUDED.wins,
  losses=EXCLUDED.losses,
  high_score=EXCLUDED.high_score,
  current_streak=EXCLUDED.current_streak,
  best_streak=EXCLUDED.best_streak,
  updated_at=NOW();

INSERT INTO game_player_rating(group_id,user_id,rating,league_points)
SELECT group_id,user_id,rating,rating
FROM game_players
ON CONFLICT(group_id,user_id) DO UPDATE SET
  rating=EXCLUDED.rating,
  league_points=EXCLUDED.league_points,
  updated_at=NOW();

INSERT INTO game_player_streaks(group_id,user_id,current_streak,best_streak)
SELECT group_id,user_id,current_streak,best_streak
FROM game_players
ON CONFLICT(group_id,user_id) DO UPDATE SET
  current_streak=EXCLUDED.current_streak,
  best_streak=EXCLUDED.best_streak,
  updated_at=NOW();
