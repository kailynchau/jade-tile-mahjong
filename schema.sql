-- Jade Tile Mahjong Club — D1 schema
--
-- Two boards: 'advanced' and 'beginner'. A player belongs to one, and a
-- round is played at one, so the two seasons never mix.
--
-- Totals are never stored. A player's score is the sum of their round
-- entries, so undoing a round is a single delete and the board stays
-- correct. A "win" is a round where the player scored highest at the
-- table, which is derived the same way — nothing to keep in sync.

DROP TABLE IF EXISTS scores;
DROP TABLE IF EXISTS rounds;
DROP TABLE IF EXISTS players;

CREATE TABLE players (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  tier       TEXT NOT NULL DEFAULT 'beginner',   -- 'advanced' | 'beginner'
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE rounds (
  id         TEXT PRIMARY KEY,
  tier       TEXT NOT NULL DEFAULT 'beginner',
  played_on  TEXT NOT NULL,          -- YYYY-MM-DD
  note       TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT                    -- who entered it
);

CREATE TABLE scores (
  round_id  TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  points    INTEGER NOT NULL,
  PRIMARY KEY (round_id, player_id)
);

CREATE INDEX idx_scores_player ON scores(player_id);
CREATE INDEX idx_rounds_played ON rounds(tier, played_on DESC);
CREATE INDEX idx_players_tier  ON players(tier, active);

-- Sign-in throttle: counts failed exec password attempts per IP.
DROP TABLE IF EXISTS login_attempts;
CREATE TABLE login_attempts (
  ip       TEXT PRIMARY KEY,
  count    INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL
);
