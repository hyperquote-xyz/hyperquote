/**
 * Terminal API — REST server for the HYPE Options Terminal
 *
 * Endpoints:
 *   GET /options/tape     — unified trade tape (Derive + HyperQuote)
 *   GET /options/ladder   — strike ladder from Derive tickers + recent trades
 *   GET /options/venues   — Derive venue snapshot (best bid/ask/mark/last)
 *
 * Uses Node.js built-in http server — zero framework deps.
 */

import "dotenv/config";
import http from "node:http";
import { query } from "./db.js";

const PORT = Number(process.env.PORT || "4200");

/**
 * CORS allowed origins. Comma-separated list (e.g. "https://app.hyperquote.io").
 * Defaults to "*" in development; MUST be set explicitly in production.
 */
const CORS_ALLOWED_ORIGINS = process.env.CORS_ALLOWED_ORIGINS ?? "*";
const corsOriginSet = CORS_ALLOWED_ORIGINS === "*"
  ? null
  : new Set(CORS_ALLOWED_ORIGINS.split(",").map((o) => o.trim()));

function getCorsOrigin(reqOrigin?: string): string {
  if (!corsOriginSet) return "*";
  if (reqOrigin && corsOriginSet.has(reqOrigin)) return reqOrigin;
  return "";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(res: http.ServerResponse, data: unknown, status = 200): void {
  const corsOrigin = getCorsOrigin(res.req?.headers?.origin as string | undefined);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
  if (corsOrigin !== "*") headers["Vary"] = "Origin";
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

function errorResponse(res: http.ServerResponse, message: string, status = 400): void {
  jsonResponse(res, { error: message }, status);
}

function parseUrl(reqUrl: string): { pathname: string; params: URLSearchParams } {
  const url = new URL(reqUrl, `http://localhost:${PORT}`);
  return { pathname: url.pathname, params: url.searchParams };
}

// ---------------------------------------------------------------------------
// GET /options/tape
// ---------------------------------------------------------------------------
// Query params:
//   ?underlying=ETH          — filter by underlying
//   ?limit=50                — row limit (default 50, max 500)
//   ?offset=0                — pagination offset
//   ?liquidityGuess=all      — all | unknown | rfq | clob (filter derive_liquidity_guess)
//   ?venue=all               — all | DERIVE | HYPERQUOTE

async function handleTape(params: URLSearchParams, res: http.ServerResponse): Promise<void> {
  const underlying = params.get("underlying");
  const limit = Math.min(Number(params.get("limit") || "50"), 500);
  const offset = Number(params.get("offset") || "0");
  const liqGuess = (params.get("liquidityGuess") || "all").toLowerCase();
  const venue = (params.get("venue") || "all").toUpperCase();

  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (underlying) {
    conditions.push(`underlying = $${paramIdx++}`);
    values.push(underlying.toUpperCase());
  }

  if (venue !== "ALL") {
    conditions.push(`venue = $${paramIdx++}`);
    values.push(venue);
  }

  // Map liquidityGuess filter to derive_liquidity_guess values
  if (liqGuess === "rfq") {
    conditions.push(`derive_liquidity_guess IN ('LIKELY_RFQ', 'RFQ')`);
  } else if (liqGuess === "clob") {
    conditions.push(`derive_liquidity_guess = 'LIKELY_CLOB'`);
  } else if (liqGuess === "unknown") {
    conditions.push(`derive_liquidity_guess = 'UNKNOWN'`);
  }
  // "all" = no filter

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const sql = `
    SELECT venue, trade_ref, instrument, underlying, is_call,
           strike_display, expiry, price, quantity_display,
           premium_usd, iv, spot_ref, side, counterparty,
           derive_liquidity_guess, ts
    FROM unified_tape
    ${where}
    ORDER BY ts DESC
    LIMIT $${paramIdx++} OFFSET $${paramIdx++}
  `;
  values.push(limit, offset);

  const result = await query(sql, values);
  jsonResponse(res, { trades: result.rows, count: result.rowCount });
}

// ---------------------------------------------------------------------------
// GET /options/ladder
// ---------------------------------------------------------------------------
// Computes a strike ladder from Derive tickers + recent trades.
// Query params:
//   ?underlying=ETH          — required
//   ?expiry=20260216         — YYYYMMDD (required)
//
// Returns per-strike: bid, ask, mark, iv, delta, oi, volume, lastTrade

async function handleLadder(params: URLSearchParams, res: http.ServerResponse): Promise<void> {
  const underlying = params.get("underlying");
  const expiryDate = params.get("expiry");

  if (!underlying || !expiryDate) {
    return errorResponse(res, "underlying and expiry query params required");
  }

  // Parse YYYYMMDD to timestamp for expiry match
  const year = Number(expiryDate.slice(0, 4));
  const month = Number(expiryDate.slice(4, 6)) - 1;
  const day = Number(expiryDate.slice(6, 8));
  const expiryTs = new Date(Date.UTC(year, month, day, 8, 0, 0));

  // Get latest ticker snapshot per instrument for this expiry
  const tickerSql = `
    SELECT DISTINCT ON (instrument_name)
      instrument_name, strike_display, is_call,
      best_bid, best_bid_amount, best_ask, best_ask_amount,
      mark_price, index_price, iv, delta, open_interest, volume_24h,
      snapshot_at
    FROM derive_tickers
    WHERE underlying = $1 AND expiry = $2
    ORDER BY instrument_name, snapshot_at DESC
  `;
  const tickers = await query(tickerSql, [underlying.toUpperCase(), expiryTs]);

  // Get last trade per instrument for this expiry (last 24h)
  const tradeSql = `
    SELECT DISTINCT ON (instrument_name)
      instrument_name, trade_price, trade_amount, direction, traded_at
    FROM derive_trades
    WHERE underlying = $1 AND expiry = $2
      AND traded_at > NOW() - INTERVAL '24 hours'
    ORDER BY instrument_name, traded_at DESC
  `;
  const trades = await query(tradeSql, [underlying.toUpperCase(), expiryTs]);

  // Build trade lookup
  const tradeMap = new Map<string, {
    price: number;
    amount: number;
    direction: string;
    tradedAt: string;
  }>();
  for (const t of trades.rows) {
    tradeMap.set(t.instrument_name, {
      price: t.trade_price,
      amount: t.trade_amount,
      direction: t.direction,
      tradedAt: t.traded_at,
    });
  }

  // Merge tickers + last trades into ladder rows
  const ladder = tickers.rows.map((tk) => ({
    instrument: tk.instrument_name,
    strike: tk.strike_display,
    isCall: tk.is_call,
    bid: tk.best_bid,
    bidSize: tk.best_bid_amount,
    ask: tk.best_ask,
    askSize: tk.best_ask_amount,
    mark: tk.mark_price,
    index: tk.index_price,
    iv: tk.iv,
    delta: tk.delta,
    oi: tk.open_interest,
    volume24h: tk.volume_24h,
    lastTrade: tradeMap.get(tk.instrument_name) || null,
    snapshotAt: tk.snapshot_at,
  }));

  // Sort by strike, then calls before puts
  ladder.sort((a, b) => {
    if (a.strike !== b.strike) return a.strike - b.strike;
    return a.isCall ? -1 : 1;
  });

  jsonResponse(res, {
    underlying: underlying.toUpperCase(),
    expiry: expiryDate,
    expiryTs: expiryTs.toISOString(),
    strikes: ladder,
  });
}

// ---------------------------------------------------------------------------
// GET /options/venues
// ---------------------------------------------------------------------------
// Returns Derive venue snapshot — best bid/ask/mark + last trade per expiry.
// Query params:
//   ?underlying=ETH          — required
//
// Returns: list of expiries, each with summary stats + per-strike data.

async function handleVenues(params: URLSearchParams, res: http.ServerResponse): Promise<void> {
  const underlying = params.get("underlying");
  if (!underlying) {
    return errorResponse(res, "underlying query param required");
  }

  // Get active expiries with latest ticker stats
  const sql = `
    SELECT
      expiry,
      COUNT(DISTINCT instrument_name) AS instruments,
      SUM(CASE WHEN is_call THEN 1 ELSE 0 END) AS calls,
      SUM(CASE WHEN NOT is_call THEN 1 ELSE 0 END) AS puts,
      MAX(index_price) AS spot,
      SUM(open_interest) AS total_oi,
      SUM(volume_24h) AS total_volume_24h,
      MAX(snapshot_at) AS last_snapshot
    FROM derive_tickers dt
    WHERE underlying = $1
      AND snapshot_at = (
        SELECT MAX(snapshot_at) FROM derive_tickers
        WHERE instrument_name = dt.instrument_name
      )
      AND expiry > NOW()
    GROUP BY expiry
    ORDER BY expiry
  `;
  const result = await query(sql, [underlying.toUpperCase()]);

  // Get recent trade count per expiry
  const tradeCountSql = `
    SELECT expiry, COUNT(*) AS trade_count_24h
    FROM derive_trades
    WHERE underlying = $1
      AND traded_at > NOW() - INTERVAL '24 hours'
      AND expiry > NOW()
    GROUP BY expiry
  `;
  const tradeCounts = await query(tradeCountSql, [underlying.toUpperCase()]);
  const tradeCountMap = new Map<string, number>();
  for (const r of tradeCounts.rows) {
    tradeCountMap.set(new Date(r.expiry).toISOString(), r.trade_count_24h);
  }

  const expiries = result.rows.map((r) => ({
    expiry: r.expiry,
    instruments: Number(r.instruments),
    calls: Number(r.calls),
    puts: Number(r.puts),
    spot: r.spot,
    totalOI: r.total_oi,
    totalVolume24h: r.total_volume_24h,
    tradeCount24h: tradeCountMap.get(new Date(r.expiry).toISOString()) || 0,
    lastSnapshot: r.last_snapshot,
  }));

  jsonResponse(res, {
    venue: "DERIVE",
    underlying: underlying.toUpperCase(),
    expiries,
    hyperquote: {
      status: "coming_soon",
      note: "HyperQuote RFQ data will appear here once there is on-chain activity.",
    },
  });
}

// ---------------------------------------------------------------------------
// GET /options/strike-detail
// ---------------------------------------------------------------------------
// Pricing detail for a single strike — used by the RFQ Suggestion panel.
// Query params:
//   ?underlying=ETH          — required
//   ?expiry=20260216         — YYYYMMDD (required)
//   ?strike=25               — strike display value (required)
//   ?isCall=true             — "true" or "false" (required)
//
// Returns: bid, ask, mark, iv, lastTrade, volume1h, tradeCount1h, spot

async function handleStrikeDetail(
  params: URLSearchParams,
  res: http.ServerResponse,
): Promise<void> {
  const underlying = params.get("underlying");
  const expiryDate = params.get("expiry");
  const strikeStr = params.get("strike");
  const isCallStr = params.get("isCall");

  if (!underlying || !expiryDate || !strikeStr || !isCallStr) {
    return errorResponse(
      res,
      "underlying, expiry, strike, and isCall query params required",
    );
  }

  const strikeVal = parseFloat(strikeStr);
  const isCall = isCallStr === "true";

  // Parse YYYYMMDD to timestamp
  const year = Number(expiryDate.slice(0, 4));
  const month = Number(expiryDate.slice(4, 6)) - 1;
  const day = Number(expiryDate.slice(6, 8));
  const expiryTs = new Date(Date.UTC(year, month, day, 8, 0, 0));

  // Get latest ticker for this specific strike
  const tickerSql = `
    SELECT
      instrument_name, best_bid, best_ask, mark_price,
      index_price, iv, volume_24h, snapshot_at
    FROM derive_tickers
    WHERE underlying = $1
      AND expiry = $2
      AND strike_display = $3
      AND is_call = $4
    ORDER BY snapshot_at DESC
    LIMIT 1
  `;
  const ticker = await query(tickerSql, [
    underlying.toUpperCase(),
    expiryTs,
    strikeVal,
    isCall,
  ]);

  // Get last trade for this instrument
  const tradeSql = `
    SELECT trade_price, trade_amount, traded_at
    FROM derive_trades
    WHERE underlying = $1
      AND expiry = $2
      AND strike_display = $3
      AND is_call = $4
    ORDER BY traded_at DESC
    LIMIT 1
  `;
  const trade = await query(tradeSql, [
    underlying.toUpperCase(),
    expiryTs,
    strikeVal,
    isCall,
  ]);

  // Get 1h volume / trade count for this instrument
  const volSql = `
    SELECT
      COALESCE(SUM(trade_amount), 0) AS volume_1h,
      COUNT(*) AS trade_count_1h
    FROM derive_trades
    WHERE underlying = $1
      AND expiry = $2
      AND strike_display = $3
      AND is_call = $4
      AND traded_at > NOW() - INTERVAL '1 hour'
  `;
  const vol = await query(volSql, [
    underlying.toUpperCase(),
    expiryTs,
    strikeVal,
    isCall,
  ]);

  const tk = ticker.rows[0] ?? null;
  const tr = trade.rows[0] ?? null;
  const v = vol.rows[0] ?? null;

  jsonResponse(res, {
    instrument: tk?.instrument_name ?? null,
    bid: tk?.best_bid ?? null,
    ask: tk?.best_ask ?? null,
    mark: tk?.mark_price ?? null,
    iv: tk?.iv ?? null,
    lastTrade: tr
      ? {
          price: tr.trade_price,
          amount: tr.trade_amount,
          tradedAt: tr.traded_at,
        }
      : null,
    volume1h: v ? Number(v.volume_1h) : null,
    tradeCount1h: v ? Number(v.trade_count_1h) : null,
    spot: tk?.index_price ?? null,
  });
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * Optional API key authentication. When API_KEY is set, all requests
 * (except /health and OPTIONS preflight) must include a matching
 * Authorization: Bearer <key> header.
 *
 * Unset in development (all requests allowed).
 */
const API_KEY = process.env.API_KEY ?? "";

function isAuthenticated(req: http.IncomingMessage): boolean {
  if (!API_KEY) return true; // no key configured → open access (dev)
  const auth = req.headers.authorization;
  if (!auth) return false;
  const [scheme, token] = auth.split(" ");
  return scheme === "Bearer" && token === API_KEY;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  // CORS preflight
  if (req.method === "OPTIONS") {
    const corsOrigin = getCorsOrigin(req.headers.origin as string | undefined);
    const headers: Record<string, string> = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
    if (corsOrigin !== "*") headers["Vary"] = "Origin";
    res.writeHead(204, headers);
    res.end();
    return;
  }

  if (req.method !== "GET") {
    return errorResponse(res, "Method not allowed", 405);
  }

  const { pathname, params } = parseUrl(req.url || "/");

  // Auth check — /health is always public
  if (pathname !== "/health" && !isAuthenticated(req)) {
    return errorResponse(res, "Unauthorized — set Authorization: Bearer <API_KEY>", 401);
  }

  try {
    switch (pathname) {
      case "/options/tape":
        await handleTape(params, res);
        break;
      case "/options/ladder":
        await handleLadder(params, res);
        break;
      case "/options/venues":
        await handleVenues(params, res);
        break;
      case "/options/strike-detail":
        await handleStrikeDetail(params, res);
        break;
      case "/health":
        jsonResponse(res, { status: "ok" });
        break;
      default:
        errorResponse(res, "Not found", 404);
    }
  } catch (err) {
    console.error(`[api] ${pathname} error:`, (err as Error).message);
    errorResponse(res, "Internal server error", 500);
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => void handleRequest(req, res));

server.listen(PORT, () => {
  console.log(`[terminal-api] Listening on http://localhost:${PORT}`);
  console.log("[terminal-api] Endpoints:");
  console.log("  GET /options/tape?underlying=ETH&limit=50&liquidityGuess=all");
  console.log("  GET /options/ladder?underlying=ETH&expiry=20260216");
  console.log("  GET /options/venues?underlying=ETH");
  console.log("  GET /options/strike-detail?underlying=ETH&expiry=20260216&strike=25&isCall=true");
  console.log("  GET /health");
});
