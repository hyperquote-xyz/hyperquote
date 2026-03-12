-- ==========================================================================
-- Migration 001: liquidity guess columns + unified_tape as real table
-- ==========================================================================
-- Run this against an existing database that has the original schema.
-- For fresh installs, use schema.sql directly (it already includes these).
-- ==========================================================================

-- 1. derive_trades: rename liquidity_type → derive_liquidity_guess, add rfq/quote ids
--    (drop old column if exists, add new one)
ALTER TABLE derive_trades
  DROP COLUMN IF EXISTS liquidity_type;

ALTER TABLE derive_trades
  ADD COLUMN IF NOT EXISTS derive_liquidity_guess TEXT NOT NULL DEFAULT 'UNKNOWN';

ALTER TABLE derive_trades
  ADD COLUMN IF NOT EXISTS rfq_id TEXT;

ALTER TABLE derive_trades
  ADD COLUMN IF NOT EXISTS quote_id TEXT;

-- hq_executions: add collateral_decimals for premium_usd formula
ALTER TABLE hq_executions
  ADD COLUMN IF NOT EXISTS collateral_decimals INTEGER;

-- 2. Indexes
DROP INDEX IF EXISTS idx_derive_trades_liquidity_type;
CREATE INDEX IF NOT EXISTS idx_derive_trades_liq_guess
  ON derive_trades (derive_liquidity_guess);
CREATE INDEX IF NOT EXISTS idx_derive_trades_rfq_id
  ON derive_trades (rfq_id) WHERE rfq_id IS NOT NULL;

-- 3. Convert unified_tape from materialized view to real table
DROP MATERIALIZED VIEW IF EXISTS unified_tape;

CREATE TABLE IF NOT EXISTS unified_tape (
    id                  BIGSERIAL PRIMARY KEY,
    venue               TEXT        NOT NULL,
    trade_ref           TEXT        NOT NULL,
    instrument          TEXT        NOT NULL,
    underlying          TEXT        NOT NULL,
    is_call             BOOLEAN     NOT NULL,
    strike              NUMERIC(78,0) NOT NULL,
    strike_display      DOUBLE PRECISION NOT NULL,
    expiry              TIMESTAMPTZ NOT NULL,
    price               DOUBLE PRECISION NOT NULL,
    quantity_display    DOUBLE PRECISION,
    quantity_raw        NUMERIC(78,0),
    premium_usd         DOUBLE PRECISION,
    iv                  DOUBLE PRECISION,
    spot_ref            DOUBLE PRECISION,
    side                TEXT,
    counterparty        TEXT,
    derive_liquidity_guess TEXT NOT NULL DEFAULT 'UNKNOWN',
    ts                  TIMESTAMPTZ NOT NULL,
    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (venue, trade_ref)
);

CREATE INDEX IF NOT EXISTS idx_unified_tape_ts         ON unified_tape (ts DESC);
CREATE INDEX IF NOT EXISTS idx_unified_tape_underlying ON unified_tape (underlying);
CREATE INDEX IF NOT EXISTS idx_unified_tape_expiry_strike
    ON unified_tape (expiry, is_call, strike);
CREATE INDEX IF NOT EXISTS idx_unified_tape_liq_guess  ON unified_tape (derive_liquidity_guess);
