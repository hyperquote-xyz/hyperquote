/**
 * Terminal Types — API response shapes for the HYPE Options Terminal
 *
 * Maps to the terminal-api REST endpoints:
 *   GET /options/tape
 *   GET /options/ladder
 *   GET /options/venues
 */

// ---------------------------------------------------------------------------
// Trade Tape
// ---------------------------------------------------------------------------

export interface TapeTrade {
  venue: "DERIVE" | "HYPERQUOTE";
  trade_ref: string;
  instrument: string;
  underlying: string;
  is_call: boolean;
  strike_display: number;
  expiry: string;
  price: number;
  quantity_display: number;
  premium_usd: number;
  iv: number | null;
  spot_ref: number | null;
  side: string;
  counterparty: string | null;
  derive_liquidity_guess: string;
  ts: string;
}

export interface TapeResponse {
  trades: TapeTrade[];
  count: number;
}

// ---------------------------------------------------------------------------
// Strike Ladder
// ---------------------------------------------------------------------------

export interface LadderStrike {
  instrument: string;
  strike: number;
  isCall: boolean;
  bid: number | null;
  bidSize: number | null;
  ask: number | null;
  askSize: number | null;
  mark: number | null;
  index: number | null;
  iv: number | null;
  delta: number | null;
  oi: number | null;
  volume24h: number | null;
  lastTrade: {
    price: number;
    amount: number;
    direction: string;
    tradedAt: string;
  } | null;
  snapshotAt: string;
}

export interface LadderResponse {
  underlying: string;
  expiry: string;
  expiryTs: string;
  strikes: LadderStrike[];
}

// ---------------------------------------------------------------------------
// Venues
// ---------------------------------------------------------------------------

export interface VenueExpiry {
  expiry: string;
  instruments: number;
  calls: number;
  puts: number;
  spot: number | null;
  totalOI: number | null;
  totalVolume24h: number | null;
  tradeCount24h: number;
  lastSnapshot: string;
}

export interface VenueResponse {
  venue: string;
  underlying: string;
  expiries: VenueExpiry[];
  hyperquote: {
    status: string;
    note: string;
  };
}

// ---------------------------------------------------------------------------
// Strike Selection (Terminal → RFQ overlay)
// ---------------------------------------------------------------------------

/** Set when user clicks a strike row in the ladder. */
export interface StrikeSelection {
  /** ISO expiry date from ladder. */
  expiry: string;
  /** Unix seconds expiry timestamp. */
  expiryTs: number;
  isCall: boolean;
  /** Human-readable strike (e.g. 25). */
  strikeDisplay: number;
  /** 1e18 fixed-point string for on-chain use. */
  strike1e18: string;
  /** Derive instrument name (e.g. ETH-20260301-2500-C). */
  instrument: string;
}

// ---------------------------------------------------------------------------
// Strike Detail (pricing data for RFQ suggestion)
// ---------------------------------------------------------------------------

export interface StrikeDetail {
  instrument: string;
  bid: number | null;
  ask: number | null;
  mark: number | null;
  iv: number | null;
  lastTrade: { price: number; amount: number; tradedAt: string } | null;
  volume1h: number | null;
  tradeCount1h: number | null;
  spot: number | null;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type LiquidityFilter = "all" | "rfq" | "clob" | "unknown";
export type VenueFilter = "all" | "DERIVE" | "HYPERQUOTE";
