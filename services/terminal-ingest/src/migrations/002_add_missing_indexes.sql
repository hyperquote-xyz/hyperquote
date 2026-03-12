-- Migration 002: Add missing indexes
--
-- Adds:
--   1. unified_tape(strike)             — single-column for strike-only queries
--   2. hq_executions(expiry, strike, is_call) — compound for position lookups
--
-- These are additive (IF NOT EXISTS) — safe to run on any database state.

-- unified_tape: single-column strike index
CREATE INDEX IF NOT EXISTS idx_unified_tape_strike
    ON unified_tape (strike);

-- hq_executions: compound index for expiry + strike + call/put queries
CREATE INDEX IF NOT EXISTS idx_hq_executions_expiry_strike_call
    ON hq_executions (expiry, strike, is_call);
