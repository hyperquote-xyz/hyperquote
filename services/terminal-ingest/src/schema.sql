-- ==========================================================================
-- HyperQuote Options Terminal — Ingestion Schema
-- ==========================================================================
-- Tables:
--   1. derive_trades       — all option trades from Derive (CLOB + RFQ)
--   2. derive_tickers      — periodic ticker snapshots from Derive
--   3. hq_executions       — QuoteExecuted events from OptionsEngine
--   4. hq_settlements      — PositionSettled + PositionExpired + settlement prices
--   5. hl_spot             — Hyperliquid spot/perp reference prices
--   6. unified_tape        — REAL TABLE: normalized trade rows from all venues
--
-- Conventions:
--   - strike stored as NUMERIC(78,0) (1e18 fixed-point) for on-chain parity
--   - human-readable display values stored alongside as DOUBLE PRECISION
--   - all timestamps are TIMESTAMPTZ (UTC)
--   - idempotent upserts via UNIQUE constraints + ON CONFLICT DO NOTHING
--
-- Premium USD normalization:
--   Derive:      premium_usd = trade_price * trade_amount
--                (Derive prices are in USD; trade_price is per-contract USD premium)
--   HyperQuote:  premium_usd = premium / 10^cDec
--                (premium is in collateral base units; collateral is a stablecoin ≈ $1)
--
-- Liquidity guess:
--   Derive does NOT expose a public RFQ-specific trades endpoint. The public
--   get_trade_history endpoint returns all trades. The response includes
--   rfq_id and quote_id fields — when rfq_id IS NOT NULL the trade was
--   filled via RFQ. We store this as derive_liquidity_guess:
--     'UNKNOWN'    — no rfq_id field or not checked
--     'LIKELY_RFQ' — rfq_id was non-null in the response payload
--     'LIKELY_CLOB'— rfq_id was explicitly null in the response payload
-- ==========================================================================

-- 1. Derive Trades (ingested from public get_trade_history)
CREATE TABLE IF NOT EXISTS derive_trades (
    id                  BIGSERIAL PRIMARY KEY,
    trade_id            TEXT        NOT NULL UNIQUE,       -- Derive UUID
    instrument_name     TEXT        NOT NULL,              -- e.g. ETH-20260216-2500-P
    underlying          TEXT        NOT NULL,              -- e.g. ETH (parsed from instrument_name)
    strike              NUMERIC(78,0) NOT NULL,            -- 1e18 fixed-point
    strike_display      DOUBLE PRECISION NOT NULL,         -- human-readable USD
    expiry              TIMESTAMPTZ NOT NULL,              -- option expiry (08:00 UTC)
    is_call             BOOLEAN     NOT NULL,
    trade_price         DOUBLE PRECISION NOT NULL,         -- per-contract USD premium
    trade_amount        DOUBLE PRECISION NOT NULL,         -- contract qty
    direction           TEXT        NOT NULL,              -- buy | sell
    index_price         DOUBLE PRECISION,                  -- underlying spot at trade time
    mark_price          DOUBLE PRECISION,                  -- mark at trade time
    iv                  DOUBLE PRECISION,                  -- implied vol (from ticker, if available)
    wallet              TEXT,                               -- trader address
    tx_hash             TEXT,                               -- on-chain tx hash
    tx_status           TEXT,                               -- settled | pending
    trade_fee           DOUBLE PRECISION,
    liquidity_role      TEXT,                               -- maker | taker
    -- Liquidity guess (best-effort heuristic)
    derive_liquidity_guess TEXT NOT NULL DEFAULT 'UNKNOWN', -- UNKNOWN | LIKELY_RFQ | LIKELY_CLOB
    rfq_id              TEXT,                               -- Derive RFQ UUID if present
    quote_id            TEXT,                               -- Derive quote UUID within RFQ
    venue               TEXT        NOT NULL DEFAULT 'DERIVE',
    traded_at           TIMESTAMPTZ NOT NULL,              -- trade timestamp
    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_derive_trades_instrument ON derive_trades (instrument_name);
CREATE INDEX IF NOT EXISTS idx_derive_trades_underlying ON derive_trades (underlying);
CREATE INDEX IF NOT EXISTS idx_derive_trades_traded_at  ON derive_trades (traded_at DESC);
CREATE INDEX IF NOT EXISTS idx_derive_trades_expiry     ON derive_trades (expiry);
CREATE INDEX IF NOT EXISTS idx_derive_trades_liq_guess  ON derive_trades (derive_liquidity_guess);
CREATE INDEX IF NOT EXISTS idx_derive_trades_rfq_id     ON derive_trades (rfq_id) WHERE rfq_id IS NOT NULL;

-- 2. Derive Tickers (periodic snapshots)
CREATE TABLE IF NOT EXISTS derive_tickers (
    id                  BIGSERIAL PRIMARY KEY,
    instrument_name     TEXT        NOT NULL,              -- e.g. ETH-20260216-2500-P
    underlying          TEXT        NOT NULL,
    strike              NUMERIC(78,0) NOT NULL,
    strike_display      DOUBLE PRECISION NOT NULL,
    expiry              TIMESTAMPTZ NOT NULL,
    is_call             BOOLEAN     NOT NULL,
    best_bid            DOUBLE PRECISION,                  -- B field
    best_bid_amount     DOUBLE PRECISION,                  -- b field
    best_ask            DOUBLE PRECISION,                  -- A field
    best_ask_amount     DOUBLE PRECISION,                  -- a field
    mark_price          DOUBLE PRECISION,                  -- M field
    index_price         DOUBLE PRECISION,                  -- I field
    -- Greeks (from option_pricing)
    iv                  DOUBLE PRECISION,                  -- i = implied vol
    delta               DOUBLE PRECISION,                  -- d
    gamma               DOUBLE PRECISION,                  -- g
    theta               DOUBLE PRECISION,                  -- t
    vega                DOUBLE PRECISION,                  -- v
    rho                 DOUBLE PRECISION,                  -- r
    forward_price       DOUBLE PRECISION,                  -- f
    -- Stats
    open_interest       DOUBLE PRECISION,                  -- stats.oi
    volume_24h          DOUBLE PRECISION,                  -- stats.v
    price_change_24h    DOUBLE PRECISION,                  -- stats.c
    high_24h            DOUBLE PRECISION,                  -- stats.h
    low_24h             DOUBLE PRECISION,                  -- stats.l
    venue               TEXT        NOT NULL DEFAULT 'DERIVE',
    snapshot_at         TIMESTAMPTZ NOT NULL,              -- when Derive reported this
    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Unique per instrument per snapshot window
    UNIQUE (instrument_name, snapshot_at)
);

CREATE INDEX IF NOT EXISTS idx_derive_tickers_instrument  ON derive_tickers (instrument_name);
CREATE INDEX IF NOT EXISTS idx_derive_tickers_underlying  ON derive_tickers (underlying);
CREATE INDEX IF NOT EXISTS idx_derive_tickers_expiry      ON derive_tickers (expiry);
CREATE INDEX IF NOT EXISTS idx_derive_tickers_snapshot_at ON derive_tickers (snapshot_at DESC);

-- 3. HyperQuote Executions (QuoteExecuted + KeeperFeePaid events)
CREATE TABLE IF NOT EXISTS hq_executions (
    id                  BIGSERIAL PRIMARY KEY,
    tx_hash             TEXT        NOT NULL,
    log_index           INTEGER     NOT NULL,
    block_number        BIGINT      NOT NULL,
    block_timestamp     TIMESTAMPTZ NOT NULL,
    -- QuoteExecuted fields
    quote_hash          TEXT        NOT NULL,              -- bytes32 indexed
    position_id         BIGINT      NOT NULL,              -- uint256 indexed
    maker               TEXT        NOT NULL,              -- address (buyer)
    taker               TEXT        NOT NULL,              -- address (seller)
    -- Decoded from Position struct (read from contract after event)
    underlying          TEXT,
    collateral          TEXT,
    is_call             BOOLEAN,
    strike              NUMERIC(78,0),                     -- 1e18 raw
    strike_display      DOUBLE PRECISION,
    quantity            NUMERIC(78,0),                     -- underlying base units
    quantity_display    DOUBLE PRECISION,
    premium             NUMERIC(78,0),                     -- collateral base units
    premium_display     DOUBLE PRECISION,
    premium_usd         DOUBLE PRECISION,                  -- = premium / 10^cDec (stablecoin ≈ $1)
    collateral_decimals INTEGER,                           -- cDec for the collateral token
    expiry              TIMESTAMPTZ,
    collateral_locked   NUMERIC(78,0),
    -- Keeper fee (from KeeperFeePaid if emitted in same tx)
    keeper_fee          NUMERIC(78,0),
    keeper_address      TEXT,
    venue               TEXT        NOT NULL DEFAULT 'HYPERQUOTE',
    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_hq_executions_quote_hash   ON hq_executions (quote_hash);
CREATE INDEX IF NOT EXISTS idx_hq_executions_position_id  ON hq_executions (position_id);
CREATE INDEX IF NOT EXISTS idx_hq_executions_maker        ON hq_executions (maker);
CREATE INDEX IF NOT EXISTS idx_hq_executions_taker        ON hq_executions (taker);
CREATE INDEX IF NOT EXISTS idx_hq_executions_block        ON hq_executions (block_number DESC);
CREATE INDEX IF NOT EXISTS idx_hq_executions_expiry       ON hq_executions (expiry);
CREATE INDEX IF NOT EXISTS idx_hq_executions_expiry_strike_call
    ON hq_executions (expiry, strike, is_call);

-- 4. HyperQuote Settlements (PositionSettled, PositionExpired, SettlementPricePublished)
CREATE TABLE IF NOT EXISTS hq_settlements (
    id                  BIGSERIAL PRIMARY KEY,
    tx_hash             TEXT        NOT NULL,
    log_index           INTEGER     NOT NULL,
    block_number        BIGINT      NOT NULL,
    block_timestamp     TIMESTAMPTZ NOT NULL,
    event_type          TEXT        NOT NULL,              -- 'settled' | 'expired' | 'price_published'
    -- PositionSettled / PositionExpired
    position_id         BIGINT,
    settler             TEXT,                               -- address who called settle()
    settlement_price    NUMERIC(78,0),                     -- 1e18 raw
    settlement_price_display DOUBLE PRECISION,
    underlying_transferred   NUMERIC(78,0),
    collateral_transferred   NUMERIC(78,0),
    collateral_returned      NUMERIC(78,0),                -- for expired positions
    returned_to              TEXT,                          -- address for expired
    -- SettlementPricePublished
    asset               TEXT,                               -- underlying address
    published_expiry    TIMESTAMPTZ,                       -- the expiry this price is for
    publisher           TEXT,                               -- oracle publisher address
    venue               TEXT        NOT NULL DEFAULT 'HYPERQUOTE',
    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_hq_settlements_position_id ON hq_settlements (position_id);
CREATE INDEX IF NOT EXISTS idx_hq_settlements_event_type  ON hq_settlements (event_type);
CREATE INDEX IF NOT EXISTS idx_hq_settlements_block       ON hq_settlements (block_number DESC);
CREATE INDEX IF NOT EXISTS idx_hq_settlements_asset       ON hq_settlements (asset);

-- 5. Hyperliquid Spot Prices
CREATE TABLE IF NOT EXISTS hl_spot (
    id                  BIGSERIAL PRIMARY KEY,
    asset               TEXT        NOT NULL,              -- e.g. HYPE, ETH, BTC
    source              TEXT        NOT NULL,              -- 'perp_mid' | 'spot_mid' | 'oracle'
    price               DOUBLE PRECISION NOT NULL,
    -- Extra context from metaAndAssetCtxs
    oracle_price        DOUBLE PRECISION,
    mark_price          DOUBLE PRECISION,
    funding_rate        DOUBLE PRECISION,
    open_interest       DOUBLE PRECISION,
    day_volume          DOUBLE PRECISION,
    sampled_at          TIMESTAMPTZ NOT NULL,              -- when we polled
    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- One row per asset per second (de-dupe fast polling)
    UNIQUE (asset, source, sampled_at)
);

CREATE INDEX IF NOT EXISTS idx_hl_spot_asset      ON hl_spot (asset);
CREATE INDEX IF NOT EXISTS idx_hl_spot_sampled_at ON hl_spot (sampled_at DESC);

-- ==========================================================================
-- 6. Unified Tape — REAL TABLE (not a materialized view)
--    Workers insert normalized rows directly on each trade ingestion.
--    This avoids periodic REFRESH latency and is always up-to-date.
--
-- Premium USD formulas:
--   venue=DERIVE:      premium_usd = trade_price * trade_amount
--   venue=HYPERQUOTE:  premium_usd = premium / 10^cDec
--
-- derive_liquidity_guess:
--   UNKNOWN     — default / no heuristic data
--   LIKELY_RFQ  — Derive payload had rfq_id != null
--   LIKELY_CLOB — Derive payload had rfq_id == null
--   RFQ         — HyperQuote (always RFQ by definition)
-- ==========================================================================
CREATE TABLE IF NOT EXISTS unified_tape (
    id                  BIGSERIAL PRIMARY KEY,
    venue               TEXT        NOT NULL,              -- DERIVE | HYPERQUOTE
    trade_ref           TEXT        NOT NULL,              -- trade_id (Derive) or quote_hash (HQ)
    instrument          TEXT        NOT NULL,              -- e.g. ETH-20260216-2500-P
    underlying          TEXT        NOT NULL,
    is_call             BOOLEAN     NOT NULL,
    strike              NUMERIC(78,0) NOT NULL,            -- 1e18
    strike_display      DOUBLE PRECISION NOT NULL,
    expiry              TIMESTAMPTZ NOT NULL,
    price               DOUBLE PRECISION NOT NULL,         -- per-contract price
    quantity_display    DOUBLE PRECISION,                  -- human qty
    quantity_raw        NUMERIC(78,0),                     -- raw base units (HQ only)
    premium_usd         DOUBLE PRECISION,                  -- total notional premium
    iv                  DOUBLE PRECISION,                  -- implied vol if known
    spot_ref            DOUBLE PRECISION,                  -- underlying price at trade time
    side                TEXT,                               -- buy | sell | trade
    counterparty        TEXT,                               -- wallet / maker address
    derive_liquidity_guess TEXT NOT NULL DEFAULT 'UNKNOWN', -- UNKNOWN | LIKELY_RFQ | LIKELY_CLOB | RFQ
    ts                  TIMESTAMPTZ NOT NULL,              -- canonical trade timestamp
    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (venue, trade_ref)
);

CREATE INDEX IF NOT EXISTS idx_unified_tape_ts         ON unified_tape (ts DESC);
CREATE INDEX IF NOT EXISTS idx_unified_tape_underlying ON unified_tape (underlying);
CREATE INDEX IF NOT EXISTS idx_unified_tape_expiry_strike
    ON unified_tape (expiry, is_call, strike);
CREATE INDEX IF NOT EXISTS idx_unified_tape_strike     ON unified_tape (strike);
CREATE INDEX IF NOT EXISTS idx_unified_tape_liq_guess  ON unified_tape (derive_liquidity_guess);
