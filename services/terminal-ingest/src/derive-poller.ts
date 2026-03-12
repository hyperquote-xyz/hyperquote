/**
 * Derive (Lyra v2) Poller
 *
 * Polls the Derive public API for:
 *   1. Tickers — option Greeks, bid/ask, IV snapshots (every TICKER_INTERVAL_MS)
 *   2. Trades  — all recent trades via get_trade_history (every TRADE_INTERVAL_MS)
 *
 * API base: https://api.lyra.finance/public/
 *
 * Endpoints:
 *   POST /get_instruments      { instrument_type, currency }
 *   POST /get_tickers          { instrument_type, currency, expiry_date: "YYYYMMDD" }
 *   POST /get_trade_history    { instrument_type?, currency?, instrument_name?, limit?, start_timestamp? }
 *
 * Note on RFQ trades:
 *   Derive does NOT expose a public RFQ-specific trades endpoint. The public
 *   get_trade_history returns all trades (CLOB + RFQ). The response includes
 *   rfq_id and quote_id fields. When rfq_id is non-null, we tag the trade as
 *   LIKELY_RFQ. When null, LIKELY_CLOB. This is a best-effort heuristic only.
 *
 * Premium USD formula (Derive):
 *   premium_usd = trade_price * trade_amount
 *   trade_price is per-contract USD premium; trade_amount is contract quantity.
 *
 * All inserts are idempotent (ON CONFLICT DO NOTHING).
 * Each trade is inserted into both derive_trades and unified_tape.
 */

import { query } from "./db.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DERIVE_API = process.env.DERIVE_API_URL || "https://api.lyra.finance/public";
const CURRENCIES = (process.env.DERIVE_CURRENCIES || "ETH,BTC").split(",").map((s) => s.trim());
const TICKER_INTERVAL_MS = Number(process.env.DERIVE_TICKER_INTERVAL_MS || "3000");
const TRADE_INTERVAL_MS = Number(process.env.DERIVE_TRADE_INTERVAL_MS || "3000");

// Track last seen trade timestamp per currency to paginate forward
const lastTradeTs = new Map<string, number>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function derivePost<T>(endpoint: string, params: Record<string, unknown>): Promise<T> {
  const url = `${DERIVE_API}/${endpoint}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Derive ${endpoint} HTTP ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) {
    throw new Error(`Derive ${endpoint} error: ${json.error.message}`);
  }
  return json.result as T;
}

/**
 * Parse Derive instrument name → components.
 * Format: ETH-20260216-2500-P
 */
function parseInstrumentName(name: string): {
  underlying: string;
  expiryDate: string;    // YYYYMMDD
  expiryTs: Date;
  strike: number;
  isCall: boolean;
} | null {
  const parts = name.split("-");
  if (parts.length !== 4) return null;
  const [underlying, expiryDate, strikeStr, side] = parts;
  const strike = Number(strikeStr);
  if (isNaN(strike)) return null;

  // Parse YYYYMMDD to Date (08:00 UTC expiry)
  const year = Number(expiryDate.slice(0, 4));
  const month = Number(expiryDate.slice(4, 6)) - 1;
  const day = Number(expiryDate.slice(6, 8));
  const expiryTs = new Date(Date.UTC(year, month, day, 8, 0, 0));

  return {
    underlying,
    expiryDate,
    expiryTs,
    strike,
    isCall: side === "C",
  };
}

/**
 * Strike to 1e18 bigint string for DB storage.
 */
function strikeTo1e18(strike: number): string {
  return (BigInt(Math.round(strike)) * 10n ** 18n).toString();
}

/**
 * Get active expiry dates for a currency.
 * Returns YYYYMMDD strings for non-expired instruments.
 */
async function getActiveExpiries(currency: string): Promise<string[]> {
  interface Instrument {
    instrument_name: string;
  }
  const result = await derivePost<{ instruments: Instrument[] }>("get_instruments", {
    instrument_type: "option",
    currency,
    expired: false,
  });
  const expiries = new Set<string>();
  for (const inst of result.instruments || []) {
    const parsed = parseInstrumentName(inst.instrument_name);
    if (parsed) {
      expiries.add(parsed.expiryDate);
    }
  }
  return [...expiries].sort();
}

/**
 * Derive liquidity guess heuristic.
 * Based on rfq_id field in the trade payload:
 *   - rfq_id truthy (non-null, non-empty) → LIKELY_RFQ
 *   - rfq_id explicitly null/empty        → LIKELY_CLOB
 */
function deriveLiquidityGuess(rfqId: string | null | undefined): string {
  if (rfqId != null && rfqId !== "") return "LIKELY_RFQ";
  return "LIKELY_CLOB";
}

// ---------------------------------------------------------------------------
// Ticker polling
// ---------------------------------------------------------------------------

interface TickerData {
  t: number;
  A: string;
  a: string;
  B: string;
  b: string;
  I: string;
  M: string;
  option_pricing: {
    d: string;
    g: string;
    t: string;
    v: string;
    i: string;
    r: string;
    f: string;
  };
  stats: {
    oi: string;
    v: string;
    c: string;
    h: string;
    l: string;
  };
}

async function pollTickers(): Promise<void> {
  for (const currency of CURRENCIES) {
    try {
      const expiries = await getActiveExpiries(currency);
      for (const expiryDate of expiries) {
        const result = await derivePost<{ tickers: Record<string, TickerData> }>(
          "get_tickers",
          { instrument_type: "option", currency, expiry_date: expiryDate },
        );

        let inserted = 0;
        for (const [instrumentName, ticker] of Object.entries(result.tickers || {})) {
          const parsed = parseInstrumentName(instrumentName);
          if (!parsed) continue;

          const snapshotAt = new Date(ticker.t);

          const res = await query(
            `INSERT INTO derive_tickers (
              instrument_name, underlying, strike, strike_display, expiry, is_call,
              best_bid, best_bid_amount, best_ask, best_ask_amount,
              mark_price, index_price,
              iv, delta, gamma, theta, vega, rho, forward_price,
              open_interest, volume_24h, price_change_24h, high_24h, low_24h,
              snapshot_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6,
              $7, $8, $9, $10,
              $11, $12,
              $13, $14, $15, $16, $17, $18, $19,
              $20, $21, $22, $23, $24,
              $25
            ) ON CONFLICT (instrument_name, snapshot_at) DO NOTHING`,
            [
              instrumentName,
              parsed.underlying,
              strikeTo1e18(parsed.strike),
              parsed.strike,
              parsed.expiryTs,
              parsed.isCall,
              parseFloat(ticker.B) || null,
              parseFloat(ticker.b) || null,
              parseFloat(ticker.A) || null,
              parseFloat(ticker.a) || null,
              parseFloat(ticker.M) || null,
              parseFloat(ticker.I) || null,
              parseFloat(ticker.option_pricing?.i) || null,
              parseFloat(ticker.option_pricing?.d) || null,
              parseFloat(ticker.option_pricing?.g) || null,
              parseFloat(ticker.option_pricing?.t) || null,
              parseFloat(ticker.option_pricing?.v) || null,
              parseFloat(ticker.option_pricing?.r) || null,
              parseFloat(ticker.option_pricing?.f) || null,
              parseFloat(ticker.stats?.oi) || null,
              parseFloat(ticker.stats?.v) || null,
              parseFloat(ticker.stats?.c) || null,
              parseFloat(ticker.stats?.h) || null,
              parseFloat(ticker.stats?.l) || null,
              snapshotAt,
            ],
          );
          if (res.rowCount && res.rowCount > 0) inserted++;
        }
        if (inserted > 0) {
          console.log(`[derive] tickers: +${inserted} ${currency} exp=${expiryDate}`);
        }
      }
    } catch (err) {
      console.error(`[derive] ticker poll error (${currency}):`, (err as Error).message);
    }
  }
}

// ---------------------------------------------------------------------------
// Trade polling — uses get_trade_history (returns CLOB + RFQ trades)
// ---------------------------------------------------------------------------

interface TradeData {
  trade_id: string;
  instrument_name: string;
  timestamp: number;         // ms
  trade_price: string;
  trade_amount: string;
  mark_price: string;
  index_price: string;
  direction: string;         // buy | sell
  quote_id: string | null;   // non-null for RFQ fills
  rfq_id: string | null;     // non-null for RFQ fills
  wallet: string;
  tx_hash: string;
  tx_status: string;
  trade_fee: string;
  liquidity_role: string;    // maker | taker
}

async function pollTrades(): Promise<void> {
  for (const currency of CURRENCIES) {
    try {
      const since = lastTradeTs.get(currency) || Date.now() - 60_000;

      const result = await derivePost<{ trades: TradeData[] }>("get_trade_history", {
        instrument_type: "option",
        currency,
        start_timestamp: since,
        limit: 100,
      });

      let clobInserted = 0;
      let rfqInserted = 0;
      let maxTs = since;

      for (const trade of result.trades || []) {
        // Only ingest option trades (skip perps if any leak through)
        const parsed = parseInstrumentName(trade.instrument_name);
        if (!parsed) continue;

        const tradedAt = new Date(trade.timestamp);
        maxTs = Math.max(maxTs, trade.timestamp);

        const tradePrice = parseFloat(trade.trade_price);
        const tradeAmount = parseFloat(trade.trade_amount);
        const liqGuess = deriveLiquidityGuess(trade.rfq_id);
        const strike1e18 = strikeTo1e18(parsed.strike);

        // Premium USD = trade_price * trade_amount
        // (Derive prices are per-contract USD premium)
        const premiumUsd = tradePrice * tradeAmount;

        // 1. Insert into derive_trades (raw storage)
        const dtRes = await query(
          `INSERT INTO derive_trades (
            trade_id, instrument_name, underlying, strike, strike_display,
            expiry, is_call, trade_price, trade_amount, direction,
            index_price, mark_price, wallet, tx_hash, tx_status,
            trade_fee, liquidity_role,
            derive_liquidity_guess, rfq_id, quote_id,
            traded_at
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15,
            $16, $17,
            $18, $19, $20,
            $21
          ) ON CONFLICT (trade_id) DO NOTHING`,
          [
            trade.trade_id,
            trade.instrument_name,
            parsed.underlying,
            strike1e18,
            parsed.strike,
            parsed.expiryTs,
            parsed.isCall,
            tradePrice,
            tradeAmount,
            trade.direction,
            parseFloat(trade.index_price) || null,
            parseFloat(trade.mark_price) || null,
            trade.wallet || null,
            trade.tx_hash || null,
            trade.tx_status || null,
            parseFloat(trade.trade_fee) || null,
            trade.liquidity_role || null,
            liqGuess,
            trade.rfq_id || null,
            trade.quote_id || null,
            tradedAt,
          ],
        );

        // 2. Insert into unified_tape (normalized) — only if derive_trades insert succeeded
        if (dtRes.rowCount && dtRes.rowCount > 0) {
          await query(
            `INSERT INTO unified_tape (
              venue, trade_ref, instrument, underlying, is_call,
              strike, strike_display, expiry,
              price, quantity_display, premium_usd,
              iv, spot_ref, side, counterparty,
              derive_liquidity_guess, ts
            ) VALUES (
              'DERIVE', $1, $2, $3, $4,
              $5, $6, $7,
              $8, $9, $10,
              $11, $12, $13, $14,
              $15, $16
            ) ON CONFLICT (venue, trade_ref) DO NOTHING`,
            [
              trade.trade_id,
              trade.instrument_name,
              parsed.underlying,
              parsed.isCall,
              strike1e18,
              parsed.strike,
              parsed.expiryTs,
              tradePrice,
              tradeAmount,
              premiumUsd,
              null, // iv — could be enriched from ticker snapshot later
              parseFloat(trade.index_price) || null,
              trade.direction,
              trade.wallet || null,
              liqGuess,
              tradedAt,
            ],
          );

          if (liqGuess === "LIKELY_RFQ") {
            rfqInserted++;
          } else {
            clobInserted++;
          }
        }
      }

      if (maxTs > since) {
        lastTradeTs.set(currency, maxTs);
      }

      if (clobInserted > 0) {
        console.log(`[derive-clob] trades: +${clobInserted} ${currency}`);
      }
      if (rfqInserted > 0) {
        console.log(`[derive-rfq] trades: +${rfqInserted} ${currency}`);
      }
    } catch (err) {
      console.error(`[derive] trade poll error (${currency}):`, (err as Error).message);
    }
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let tickerTimer: ReturnType<typeof setInterval> | null = null;
let tradeTimer: ReturnType<typeof setInterval> | null = null;

export function startDerivePoller(): void {
  console.log(
    `[derive] Starting poller — currencies=${CURRENCIES.join(",")} ` +
    `ticker=${TICKER_INTERVAL_MS}ms trade=${TRADE_INTERVAL_MS}ms`,
  );

  // Initial polls
  void pollTickers();
  void pollTrades();

  // Recurring polls
  tickerTimer = setInterval(() => void pollTickers(), TICKER_INTERVAL_MS);
  tradeTimer = setInterval(() => void pollTrades(), TRADE_INTERVAL_MS);
}

export function stopDerivePoller(): void {
  if (tickerTimer) clearInterval(tickerTimer);
  if (tradeTimer) clearInterval(tradeTimer);
  tickerTimer = null;
  tradeTimer = null;
  console.log("[derive] Poller stopped.");
}
