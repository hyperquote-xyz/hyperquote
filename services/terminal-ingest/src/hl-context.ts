/**
 * Hyperliquid Context Poller
 *
 * Polls Hyperliquid's public info API for spot/perp reference prices.
 *
 * Two data sources:
 *   1. allMids      — simple mid prices for all assets (fast, small payload)
 *   2. metaAndAssetCtxs — full context: oracle, mark, funding, OI, volume
 *
 * API: POST https://api.hyperliquid.xyz/info
 *
 * Key asset mappings:
 *   - "HYPE"  → perp mid price
 *   - "@107"  → HYPE/USDC spot mid price
 *   - "ETH"   → ETH perp mid price
 *   - "BTC"   → BTC perp mid price
 *
 * All inserts are idempotent via UNIQUE (asset, source, sampled_at).
 */

import { query } from "./db.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const HL_API = process.env.HL_API_URL || "https://api.hyperliquid.xyz/info";
const POLL_INTERVAL_MS = Number(process.env.HL_POLL_INTERVAL_MS || "3000");

/**
 * Assets to track. Each entry maps a canonical name to its allMids key
 * and its perp universe index (for metaAndAssetCtxs lookup).
 */
const TRACKED_ASSETS: {
  canonical: string;
  midKey: string;        // key in allMids response
  source: string;        // perp_mid | spot_mid
  perpIndex?: number;    // index in metaAndAssetCtxs universe (for rich data)
}[] = [
  { canonical: "HYPE", midKey: "HYPE", source: "perp_mid", perpIndex: 159 },
  { canonical: "HYPE", midKey: "@107", source: "spot_mid" },
  { canonical: "ETH", midKey: "ETH", source: "perp_mid", perpIndex: 1 },
  { canonical: "BTC", midKey: "BTC", source: "perp_mid", perpIndex: 0 },
];

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

interface AllMidsResponse {
  [key: string]: string;  // asset → price string
}

interface AssetCtx {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  premium: string;
  oraclePx: string;
  markPx: string;
  midPx: string;
  impactPxs: [string, string];
  dayBaseVlm: string;
}

interface MetaAndAssetCtxsResponse {
  0: { universe: { name: string; szDecimals: number; maxLeverage: number }[] };
  1: AssetCtx[];
}

async function hlPost<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(HL_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HL API HTTP ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Failure tracking
// ---------------------------------------------------------------------------

let consecutiveMidFailures = 0;
let consecutiveCtxFailures = 0;
let lastSuccessfulMidPoll: Date | null = null;
let lastSuccessfulCtxPoll: Date | null = null;
const STALE_WARN_THRESHOLD = 5; // log warning after this many consecutive failures
const STALE_SECONDS_THRESHOLD = 60; // log staleness warning if mids data older than this
let staleWarnEmitted = false; // only emit the 60s staleness warning once until recovery

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

/**
 * Fast poll — just mid prices from allMids.
 * Small payload, suitable for 2-3s intervals.
 */
async function pollMids(): Promise<void> {
  try {
    const mids = await hlPost<AllMidsResponse>({ type: "allMids" });
    const now = new Date();
    // Truncate to nearest second for dedup
    now.setMilliseconds(0);

    let inserted = 0;

    for (const asset of TRACKED_ASSETS) {
      const priceStr = mids[asset.midKey];
      if (!priceStr) continue;

      const price = parseFloat(priceStr);
      if (isNaN(price) || price <= 0) continue;

      const res = await query(
        `INSERT INTO hl_spot (asset, source, price, sampled_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (asset, source, sampled_at) DO NOTHING`,
        [asset.canonical, asset.source, price, now],
      );
      if (res.rowCount && res.rowCount > 0) inserted++;
    }

    if (inserted > 0) {
      console.log(`[hl] mids: +${inserted} rows`);
    }

    // Reset failure counter on success
    if (consecutiveMidFailures > 0) {
      console.log(`[hl] allMids recovered after ${consecutiveMidFailures} consecutive failures`);
    }
    consecutiveMidFailures = 0;
    staleWarnEmitted = false;
    lastSuccessfulMidPoll = new Date();
  } catch (err) {
    consecutiveMidFailures++;
    console.error(
      `[hl] allMids poll error (failure #${consecutiveMidFailures}):`,
      (err as Error).message,
    );
    if (consecutiveMidFailures === STALE_WARN_THRESHOLD) {
      console.warn(
        `[hl] WARNING: ${STALE_WARN_THRESHOLD} consecutive failures polling allMids`,
      );
    }
    // Staleness check: warn if last success was > 60s ago
    if (
      lastSuccessfulMidPoll &&
      !staleWarnEmitted &&
      Date.now() - lastSuccessfulMidPoll.getTime() > STALE_SECONDS_THRESHOLD * 1000
    ) {
      console.warn(`[hl] WARNING: hl_spot data stale (>60s)`);
      staleWarnEmitted = true;
    }
  }
}

/**
 * Rich poll — full asset contexts with oracle, mark, funding, OI.
 * Larger payload, runs less frequently (every ~10s).
 */
async function pollContext(): Promise<void> {
  try {
    const raw = await hlPost<[
      { universe: { name: string }[] },
      AssetCtx[],
    ]>({ type: "metaAndAssetCtxs" });

    const [meta, ctxs] = raw;
    const now = new Date();
    now.setMilliseconds(0);

    let inserted = 0;

    for (const asset of TRACKED_ASSETS) {
      if (asset.perpIndex === undefined) continue;
      if (asset.perpIndex >= ctxs.length) continue;

      const ctx = ctxs[asset.perpIndex];
      if (!ctx) continue;

      const oraclePrice = parseFloat(ctx.oraclePx);
      if (isNaN(oraclePrice) || oraclePrice <= 0) continue;

      const res = await query(
        `INSERT INTO hl_spot (
          asset, source, price,
          oracle_price, mark_price, funding_rate,
          open_interest, day_volume, sampled_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (asset, source, sampled_at) DO UPDATE SET
          oracle_price = EXCLUDED.oracle_price,
          mark_price = EXCLUDED.mark_price,
          funding_rate = EXCLUDED.funding_rate,
          open_interest = EXCLUDED.open_interest,
          day_volume = EXCLUDED.day_volume`,
        [
          asset.canonical,
          "oracle",
          oraclePrice,
          oraclePrice,
          parseFloat(ctx.markPx) || null,
          parseFloat(ctx.funding) || null,
          parseFloat(ctx.openInterest) || null,
          parseFloat(ctx.dayNtlVlm) || null,
          now,
        ],
      );
      if (res.rowCount && res.rowCount > 0) inserted++;
    }

    if (inserted > 0) {
      console.log(`[hl] context: +${inserted} rows`);
    }

    // Reset failure counter on success
    if (consecutiveCtxFailures > 0) {
      console.log(`[hl] metaAndAssetCtxs recovered after ${consecutiveCtxFailures} consecutive failures`);
    }
    consecutiveCtxFailures = 0;
    lastSuccessfulCtxPoll = new Date();
  } catch (err) {
    consecutiveCtxFailures++;
    console.error(
      `[hl] metaAndAssetCtxs poll error (failure #${consecutiveCtxFailures}):`,
      (err as Error).message,
    );
    if (consecutiveCtxFailures === STALE_WARN_THRESHOLD) {
      console.warn(
        `[hl] WARNING: ${STALE_WARN_THRESHOLD} consecutive failures polling metaAndAssetCtxs`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let midTimer: ReturnType<typeof setInterval> | null = null;
let ctxTimer: ReturnType<typeof setInterval> | null = null;

const CONTEXT_INTERVAL_MS = Number(process.env.HL_CONTEXT_INTERVAL_MS || "10000");

export function startHlPoller(): void {
  console.log(
    `[hl] Starting poller — mids=${POLL_INTERVAL_MS}ms context=${CONTEXT_INTERVAL_MS}ms`,
  );

  // Initial polls
  void pollMids();
  void pollContext();

  // Recurring
  midTimer = setInterval(() => void pollMids(), POLL_INTERVAL_MS);
  ctxTimer = setInterval(() => void pollContext(), CONTEXT_INTERVAL_MS);
}

export function stopHlPoller(): void {
  if (midTimer) clearInterval(midTimer);
  if (ctxTimer) clearInterval(ctxTimer);
  midTimer = null;
  ctxTimer = null;
  console.log("[hl] Poller stopped.");
}
