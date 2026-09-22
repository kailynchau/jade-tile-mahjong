-- Adds the sign-in throttle table to an existing database.
-- Safe to run more than once.
--
--   npx wrangler d1 execute jade-tile --remote --file=./migrate-auth.sql

CREATE TABLE IF NOT EXISTS login_attempts (
  ip       TEXT PRIMARY KEY,
  count    INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL
);
