/**
 * Unified Venue Comparison Service
 *
 * Single source of truth for comparing swap execution across venues:
 *   - HyperCore Spot (L2 orderbook walk via `estimateHyperliquidSpotRich`)
 *   - HyperEVM DEX   (ht.xyz routing via `/api/v1/bench/ht/price`)
 *   - Mid-Price Ref   (orderbook mid benchmark from `benchmark.ts`)
 *
 * All UI surfaces — /swap, feed drawer, homepage — consume `estimateVenues()`
 * or the companion `useVenueComparison` React hook.
 *
 * Key properties:
 *   • Structured failures — never "Unavailable", always a reason code
 *   • Retry with jitter  — one automatic retry on transient errors
 *   • AbortSignal-aware  — callers can cancel in-flight requests
 *   • Dev-only logging   — structured console.debug per venue
 */

import type { Token, AMMEstimate } from "@/types";
import { type MidPriceRef, getMidPriceRef, impactExactIn } from "@/lib/benchmark";
import {
  estimateHyperliquidSpotRich,
  getUsdPrice,
  type HypercoreEstimateResult,
} from "@/lib/hyperliquid";
import { resolveSettlementToken } from "@/lib/native-wrap";
import { quotePrjxRoute, type PrjxRouteResult } from "@/lib/prjxQuoter";
import { fetchHtQuote } from "@/lib/reference-engine/ht";

// ---------------------------------------------------------------------------
// Failure reasons — structured, never just "Unavailable"
// ---------------------------------------------------------------------------

export type VenueFailureReason =
  | "no_hl_market"         // token has no Hyperliquid spot market
  | "transient_failure"    // network/timeout, retries exhausted
  | "unsupported_pair"     // neither venue can handle this pair
  | "no_dex_route"         // DEX aggregator returned null (no route found)
  | "aborted";             // request cancelled via AbortSignal

// ---------------------------------------------------------------------------
// Per-venue result — discriminated union
// ---------------------------------------------------------------------------

export interface VenueSuccess {
  ok: true;
  estimate: AMMEstimate;
  routeLabel: string;           // e.g. "USDH → USDC → PURR"
  slippageVsMid: number | null; // % impact vs mid-price benchmark, null if mid unavailable
}

export interface VenuePartial {
  ok: "partial";
  /** 0.0–1.0 fraction of the order that could be filled */
  filledPct: number;
  /** Amount of tokenIn consumed (raw bigint with full decimals) */
  filledIn: bigint;
  /** Amount of tokenOut received (raw bigint with full decimals) */
  filledOut: bigint;
  /** Remaining tokenIn that could NOT be filled */
  remainingIn: bigint;
  /** Average execution price for the filled portion */
  avgPrice: number;
  /** Slippage of the filled portion vs mid-price (%) */
  slippagePct: number;
  /** Slippage vs mid-price benchmark, null if unavailable */
  slippageVsMid: number | null;
  routeLabel: string;
  reason: "insufficient_liquidity";
}

export interface VenueFailure {
  ok: false;
  reason: VenueFailureReason;
  routeLabel: string;           // best-effort label even on failure
}

export type VenueResult = VenueSuccess | VenuePartial | VenueFailure;

// ---------------------------------------------------------------------------
// Combined result from estimateVenues
// ---------------------------------------------------------------------------

export interface VenueComparisonResult {
  hypercore: VenueResult;
  dex: VenueResult;
  /** HT R1 aggregator result (7+ DEXs) */
  ht: VenueResult;
  midRef: MidPriceRef | null;
  /** Total wall-clock time for the entire parallel fetch (ms) */
  timingMs: number;
}

// ---------------------------------------------------------------------------
// Input params
// ---------------------------------------------------------------------------

export interface EstimateVenuesParams {
  tokenIn: Token;
  tokenOut: Token;
  amountIn: bigint;
  /** Optional: for exact-out benchmark reference */
  amountOut?: bigint;
  /** Exact type hint for HT.xyz routing */
  exactType?: "EXACT_IN" | "EXACT_OUT";
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Join route symbols with " → " or fall back to tokenIn → tokenOut. */
function buildRouteLabel(
  tokenIn: Token,
  tokenOut: Token,
  route?: string[],
): string {
  if (route && route.length >= 2) return route.join(" → ");
  return `${tokenIn.symbol} → ${tokenOut.symbol}`;
}

/** Classify why HyperCore estimation returned null (not a thrown error). */
function classifyHypercoreFailure(
  _tokenIn: Token,
  _tokenOut: Token,
): VenueFailureReason {
  // With rich adaptive helpers, null means zero orderbook liquidity at every
  // depth level — functionally equivalent to having no market.
  return "no_hl_market";
}

/** True for transient errors worth retrying (network, 5xx). */
function isTransient(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return false;
  if (err instanceof TypeError) return true; // fetch network error
  if (err instanceof Error && /5\d\d/.test(err.message)) return true;
  return true; // default: retry
}

/**
 * Generic retry wrapper with jitter.
 * Retries once on transient failure after 200-500ms random delay.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (signal?.aborted) throw err;
    if (!isTransient(err)) throw err;

    // One retry with jitter
    const jitter = 200 + Math.random() * 300; // 200-500ms
    await new Promise((r) => setTimeout(r, jitter));

    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    return fn();
  }
}

/**
 * Rich HyperCore estimation — returns full estimate or best partial fill info.
 * Delegates to estimateHyperliquidSpotRich for tri-state results.
 */
async function estimateHypercoreRich(
  tokenIn: Token,
  tokenOut: Token,
  amountIn: bigint,
): Promise<HypercoreEstimateResult> {
  return estimateHyperliquidSpotRich(tokenIn, tokenOut, amountIn);
}

// ---------------------------------------------------------------------------
// HT.xyz EVM DEX quote — extracted single copy
// ---------------------------------------------------------------------------

/**
 * Fetch a real DEX quote from HT.xyz via our server-side proxy.
 * Returns null on any non-success response.
 */
export async function fetchHtxyzQuote(
  tokenIn: Token,
  tokenOut: Token,
  amountIn: bigint,
  signal?: AbortSignal,
): Promise<AMMEstimate | null> {
  // HT.xyz is an EVM DEX aggregator — always use ERC-20 addresses (HYPE → wHYPE)
  const params = new URLSearchParams({
    sellToken: resolveSettlementToken(tokenIn).address,
    buyToken: resolveSettlementToken(tokenOut).address,
    sellAmount: amountIn.toString(),
  });

  const res = await fetch(`/api/v1/bench/ht/price?${params}`, { signal });
  if (!res.ok) return null;

  const json = await res.json();
  if (!json.outputAmount) return null;

  // HT.xyz outputAmount is human-readable (e.g. "1032522.17")
  const humanOut = parseFloat(json.outputAmount);
  if (isNaN(humanOut) || humanOut <= 0) return null;

  const amountOut = BigInt(Math.floor(humanOut * 10 ** tokenOut.decimals));
  const normalizedIn = Number(amountIn) / 10 ** tokenIn.decimals;

  // priceImpact left as 0 — display layer computes via universal benchmark
  return {
    source: "HyperEVM DEX",
    amountOut,
    priceImpact: 0,
    effectivePrice: normalizedIn > 0 ? humanOut / normalizedIn : undefined,
    poolLiquidity: 0n,
    route: [tokenIn.symbol, tokenOut.symbol],
    isDirect: true,
    hops: 1,
  };
}

// ---------------------------------------------------------------------------
// HT.xyz multi-hop routing — route through liquid intermediates
// ---------------------------------------------------------------------------

/**
 * Liquid intermediate tokens for multi-hop DEX routing.
 * When HT.xyz can't find a direct route (e.g. USDH → PURR), we try
 * chaining two legs through each intermediate (USDH → USDC → PURR).
 */
const ROUTING_INTERMEDIATES: { address: string; symbol: string; decimals: number }[] = [
  { address: "0xb88339cb7199b77e23db6e890353e22632ba630f", symbol: "USDC", decimals: 6 },
  { address: "0x5555555555555555555555555555555555555555", symbol: "WHYPE", decimals: 18 },
  { address: "0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb", symbol: "USD₮0", decimals: 6 },
];

/**
 * Attempt multi-hop routing through liquid intermediates when the direct
 * HT.xyz quote returns null.
 *
 * For each intermediate token, chains two HT.xyz calls:
 *   Leg 1: tokenIn → intermediate (sell amountIn)
 *   Leg 2: intermediate → tokenOut (sell leg1 output)
 *
 * Returns the best result (highest amountOut) or null if no route found.
 */
async function fetchHtxyzMultiHopQuote(
  tokenIn: Token,
  tokenOut: Token,
  amountIn: bigint,
  signal?: AbortSignal,
): Promise<AMMEstimate | null> {
  const sellAddr = resolveSettlementToken(tokenIn).address.toLowerCase();
  const buyAddr = resolveSettlementToken(tokenOut).address.toLowerCase();

  // Filter out intermediates that match tokenIn or tokenOut
  const candidates = ROUTING_INTERMEDIATES.filter(
    (t) => t.address.toLowerCase() !== sellAddr && t.address.toLowerCase() !== buyAddr,
  );

  if (candidates.length === 0) return null;

  // Try all intermediates in parallel
  const results = await Promise.allSettled(
    candidates.map(async (intermediate) => {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

      const intermediateToken: Token = {
        address: intermediate.address as `0x${string}`,
        symbol: intermediate.symbol,
        name: intermediate.symbol,
        decimals: intermediate.decimals,
      };

      // Leg 1: tokenIn → intermediate
      const leg1 = await fetchHtxyzQuote(tokenIn, intermediateToken, amountIn, signal);
      if (!leg1 || leg1.amountOut <= 0n) return null;

      // Leg 2: intermediate → tokenOut (sell leg1 output)
      const leg2 = await fetchHtxyzQuote(intermediateToken, tokenOut, leg1.amountOut, signal);
      if (!leg2 || leg2.amountOut <= 0n) return null;

      return {
        amountOut: leg2.amountOut,
        intermediateSymbol: intermediate.symbol,
        leg1,
        leg2,
      };
    }),
  );

  // Find best result by amountOut
  let best: { amountOut: bigint; intermediateSymbol: string; leg1: AMMEstimate; leg2: AMMEstimate } | null = null;
  for (const r of results) {
    if (r.status !== "fulfilled" || r.value === null) continue;
    if (!best || r.value.amountOut > best.amountOut) {
      best = r.value;
    }
  }

  if (!best) return null;

  const normalizedIn = Number(amountIn) / 10 ** tokenIn.decimals;
  const normalizedOut = Number(best.amountOut) / 10 ** tokenOut.decimals;

  if (process.env.NODE_ENV === "development") {
    console.debug("[venueComparison] Multi-hop DEX route found", {
      path: `${tokenIn.symbol} → ${best.intermediateSymbol} → ${tokenOut.symbol}`,
      amountOut: normalizedOut.toFixed(4),
    });
  }

  return {
    source: "HyperEVM DEX",
    amountOut: best.amountOut,
    priceImpact: 0,
    effectivePrice: normalizedIn > 0 ? normalizedOut / normalizedIn : undefined,
    poolLiquidity: 0n,
    route: [tokenIn.symbol, best.intermediateSymbol, tokenOut.symbol],
    isDirect: false,
    hops: 2,
  };
}

// ---------------------------------------------------------------------------
// HT.xyz binary search — find max fillable size when full amount fails
// ---------------------------------------------------------------------------

const HTXYZ_MIN_SEARCH_USD = 25_000;
const HTXYZ_SEARCH_MAX_ITERS = 6;

/**
 * Binary search for the largest amount that HT.xyz can fill.
 * Only runs when the original full-amount quote returned null and
 * the trade size exceeds $25k USD.
 *
 * Returns the largest successful amount and its estimate, or null
 * if nothing fills at all (true "no route").
 */
async function searchHtxyzMaxFill(
  tokenIn: Token,
  tokenOut: Token,
  originalAmountIn: bigint,
  signal?: AbortSignal,
): Promise<{ filledPct: number; amountIn: bigint; estimate: AMMEstimate } | null> {
  // Check USD value — only search for large trades
  const tokenPrice = await getUsdPrice(tokenIn);
  if (tokenPrice === null) return null;

  const normalizedIn = Number(originalAmountIn) / 10 ** tokenIn.decimals;
  const usdValue = normalizedIn * tokenPrice;
  if (usdValue < HTXYZ_MIN_SEARCH_USD) return null;

  let lo = 0n;
  let hi = originalAmountIn;
  let lastSuccess: { amountIn: bigint; estimate: AMMEstimate } | null = null;

  for (let i = 0; i < HTXYZ_SEARCH_MAX_ITERS; i++) {
    if (signal?.aborted) break;

    const mid = (lo + hi) / 2n;
    if (mid <= 0n) break;

    const result = await fetchHtxyzQuote(tokenIn, tokenOut, mid, signal);
    if (result) {
      lastSuccess = { amountIn: mid, estimate: result };
      lo = mid; // search higher
    } else {
      hi = mid; // search lower
    }

    // Converged — less than 1% gap
    if (hi - lo < originalAmountIn / 100n) break;
  }

  if (!lastSuccess) return null;

  const filledPct = Number(lastSuccess.amountIn) / Number(originalAmountIn);

  if (process.env.NODE_ENV === "development") {
    console.debug("[venueComparison] HT.xyz binary search result", {
      pair: `${tokenIn.symbol} → ${tokenOut.symbol}`,
      originalUsd: usdValue.toFixed(0),
      filledPct: (filledPct * 100).toFixed(1) + "%",
      filledAmountIn: lastSuccess.amountIn.toString(),
    });
  }

  return {
    filledPct,
    amountIn: lastSuccess.amountIn,
    estimate: lastSuccess.estimate,
  };
}

// ---------------------------------------------------------------------------
// PRJX DEX quote — on-chain QuoterV2 (replaces HT.xyz for launch)
// ---------------------------------------------------------------------------

/**
 * Fetch a real DEX quote from PRJX on-chain pools via QuoterV2.
 * Returns AMMEstimate or null (matching the HT.xyz interface).
 *
 * Uses automatic routing: direct → via USDC → via WHYPE.
 */
async function fetchPrjxQuote(
  tokenIn: Token,
  tokenOut: Token,
  amountIn: bigint,
  signal?: AbortSignal,
): Promise<AMMEstimate | null> {
  // Calculate ideal output from mid-price for slippage computation
  const priceIn = await getUsdPrice(tokenIn);
  const priceOut = await getUsdPrice(tokenOut);
  const normalizedIn = Number(amountIn) / 10 ** tokenIn.decimals;
  const idealOutputTokens = priceIn && priceOut && priceOut > 0
    ? (normalizedIn * priceIn) / priceOut
    : 0;

  const result = await quotePrjxRoute(tokenIn, tokenOut, amountIn, idealOutputTokens, signal);

  if (result.status === "no_pool" || result.amountOut === 0n) return null;

  return {
    source: "PRJX DEX",
    amountOut: result.amountOut,
    priceImpact: result.slippagePct,
    effectivePrice: normalizedIn > 0 ? result.amountOutHuman / normalizedIn : undefined,
    poolLiquidity: 0n,
    route: result.route,
    isDirect: result.isDirect,
    hops: result.isDirect ? 1 : 2,
  };
}

// ---------------------------------------------------------------------------
// Shared UI text — maps failure reason → user-facing explanation
// ---------------------------------------------------------------------------

/**
 * Exhaustive mapping from VenueFailureReason → human-readable text.
 * All UI surfaces import this instead of maintaining local copies.
 */
export function venueFailureText(
  reason: VenueFailureReason,
  venue: "hypercore" | "dex",
): string {
  switch (reason) {
    case "no_hl_market":     return "No HyperCore spot market for this pair.";
    case "transient_failure":
      return venue === "dex"
        ? "DEX routing temporarily delayed — retrying."
        : "HyperCore estimate temporarily delayed — retrying.";
    case "no_dex_route":     return "No DEX route found for this pair.";
    case "unsupported_pair": return "This pair is not supported.";
    case "aborted":          return "Estimate cancelled.";
  }
}

/**
 * Human-readable text for partial fill results.
 */
export function venuePartialText(filledPct: number): string {
  return `Partial fill: ${(filledPct * 100).toFixed(1)}% of requested size.`;
}

// ---------------------------------------------------------------------------
// Dev logging
// ---------------------------------------------------------------------------

function devLog(
  venue: string,
  result: VenueResult,
  timingMs: number,
  params: EstimateVenuesParams,
): void {
  if (process.env.NODE_ENV !== "development") return;
  const base = {
    venue,
    ok: result.ok,
    routeLabel: result.routeLabel,
    tokens: `${params.tokenIn.symbol} → ${params.tokenOut.symbol}`,
    exactType: params.exactType ?? "EXACT_IN",
    timingMs: Math.round(timingMs),
  };
  if (result.ok === true) {
    console.debug("[venueComparison]", { ...base, slippageVsMid: result.slippageVsMid });
  } else if (result.ok === "partial") {
    console.debug("[venueComparison]", {
      ...base,
      filledPct: (result.filledPct * 100).toFixed(1) + "%",
      reason: result.reason,
    });
  } else {
    console.debug("[venueComparison]", { ...base, reason: result.reason });
  }
}

// ---------------------------------------------------------------------------
// Main — estimateVenues
// ---------------------------------------------------------------------------

/**
 * Estimate swap execution across all venues in parallel.
 *
 * Returns structured results for each venue — always a VenueSuccess,
 * VenuePartial, or VenueFailure, never null / "Unavailable".
 */
export async function estimateVenues(
  params: EstimateVenuesParams,
): Promise<VenueComparisonResult> {
  const { tokenIn, tokenOut, amountIn, amountOut, signal } = params;
  const t0 = performance.now();

  const fallbackRoute = buildRouteLabel(tokenIn, tokenOut);

  // Early: abort
  if (signal?.aborted) {
    const aborted: VenueFailure = { ok: false, reason: "aborted", routeLabel: fallbackRoute };
    return { hypercore: aborted, dex: aborted, ht: aborted, midRef: null, timingMs: 0 };
  }

  // Early: no amount
  if (amountIn <= 0n) {
    const empty: VenueFailure = { ok: false, reason: "unsupported_pair", routeLabel: fallbackRoute };
    return { hypercore: empty, dex: empty, ht: empty, midRef: null, timingMs: 0 };
  }

  // ----- Parallel fetch: HyperCore, PRJX, HT R1, Mid-Price -----
  const [hlSettled, dexSettled, htSettled, midSettled] = await Promise.allSettled([
    withRetry(() => estimateHypercoreRich(tokenIn, tokenOut, amountIn), signal),
    withRetry(() => fetchPrjxQuote(tokenIn, tokenOut, amountIn, signal), signal),
    withRetry(() => fetchHtQuote(tokenIn, tokenOut, amountIn, signal), signal),
    getMidPriceRef(tokenIn, tokenOut, amountIn, amountOut).catch(() => null),
  ]);

  // Check abort after await
  if (signal?.aborted) {
    const aborted: VenueFailure = { ok: false, reason: "aborted", routeLabel: fallbackRoute };
    return { hypercore: aborted, dex: aborted, ht: aborted, midRef: null, timingMs: performance.now() - t0 };
  }

  const midRef = midSettled.status === "fulfilled" ? midSettled.value : null;
  const hlTimingMs = performance.now() - t0;

  // ----- Post-process HyperCore (tri-state) -----
  let hypercore: VenueResult;
  if (hlSettled.status === "fulfilled" && hlSettled.value != null) {
    const hlResult = hlSettled.value;

    if (hlResult.full) {
      // Full fill → VenueSuccess
      const est = hlResult.estimate;
      // Use the simulation's own execution slippage (priceImpact) for HyperCore,
      // not the benchmark comparison. The simulation computes slippage vs mid-price
      // from the same orderbook it walks, matching Hyperliquid UI "Est slippage".
      // Fall back to benchmark only if simulation value is missing/zero.
      //
      // NOTE: Crossed orderbooks (bestBid > bestAsk) produce 0% slippage for
      // both simulation and benchmark — the execution price genuinely beats
      // the mid-price reference, so impact is clamped to 0. This is correct
      // per HL UI semantics: you're getting a better price than mid.
      const slippageVsMid = est.priceImpact > 0
        ? est.priceImpact
        : (midRef && midRef.referenceOut > 0n
            ? impactExactIn(midRef.referenceOut, est.amountOut)
            : null);
      hypercore = {
        ok: true,
        estimate: est,
        routeLabel: buildRouteLabel(tokenIn, tokenOut, est.route),
        slippageVsMid,
      };
    } else {
      // Partial fill → VenuePartial
      const partial = hlResult.partial;
      const filledIn = BigInt(
        Math.floor(partial.filledUsd * 10 ** tokenIn.decimals)
      );
      const filledOut = BigInt(
        Math.floor(partial.filledTokens * 10 ** tokenOut.decimals)
      );
      // Scale mid-price reference to the filled portion — comparing partial
      // output against the FULL reference would massively overstate slippage.
      const scaledRef = midRef && midRef.referenceOut > 0n
        ? BigInt(Math.round(Number(midRef.referenceOut) * partial.filledPct))
        : 0n;
      const slippageVsMid = scaledRef > 0n && filledOut > 0n
        ? impactExactIn(scaledRef, filledOut)
        : null;
      hypercore = {
        ok: "partial",
        filledPct: partial.filledPct,
        filledIn,
        filledOut,
        remainingIn: amountIn - filledIn,
        avgPrice: partial.avgPrice,
        slippagePct: partial.slippagePct,
        slippageVsMid,
        routeLabel: fallbackRoute,
        reason: "insufficient_liquidity",
      };
    }
  } else if (hlSettled.status === "rejected") {
    // Thrown error → transient failure
    hypercore = {
      ok: false,
      reason: "transient_failure",
      routeLabel: fallbackRoute,
    };
  } else {
    // Fulfilled with null → structural (no market or no data at all)
    hypercore = {
      ok: false,
      reason: classifyHypercoreFailure(tokenIn, tokenOut),
      routeLabel: fallbackRoute,
    };
  }

  // ----- Post-process DEX (tri-state) -----
  let dex: VenueResult;
  if (dexSettled.status === "fulfilled" && dexSettled.value != null) {
    // Full fill → VenueSuccess
    const est = dexSettled.value;
    const slippageVsMid =
      midRef && midRef.referenceOut > 0n
        ? impactExactIn(midRef.referenceOut, est.amountOut)
        : null;
    dex = {
      ok: true,
      estimate: est,
      routeLabel: buildRouteLabel(tokenIn, tokenOut, est.route),
      slippageVsMid,
    };
  } else if (dexSettled.status === "rejected") {
    dex = {
      ok: false,
      reason: "transient_failure",
      routeLabel: fallbackRoute,
    };
  } else {
    // PRJX quoter already handles multi-hop (via USDC, via WHYPE) internally.
    // If it returned null, there is genuinely no viable DEX route.
    dex = {
      ok: false,
      reason: signal?.aborted ? "aborted" : "no_dex_route",
      routeLabel: fallbackRoute,
    };
  }

  // ----- Post-process HT R1 -----
  let ht: VenueResult;
  if (htSettled.status === "fulfilled" && htSettled.value != null) {
    const est = htSettled.value;
    const slippageVsMid =
      midRef && midRef.referenceOut > 0n
        ? impactExactIn(midRef.referenceOut, est.amountOut)
        : null;
    ht = {
      ok: true,
      estimate: est,
      routeLabel: buildRouteLabel(tokenIn, tokenOut, est.route),
      slippageVsMid,
    };
  } else if (htSettled.status === "rejected") {
    ht = { ok: false, reason: "transient_failure", routeLabel: fallbackRoute };
  } else {
    ht = { ok: false, reason: "no_dex_route", routeLabel: fallbackRoute };
  }

  const timingMs = performance.now() - t0;

  // ----- Dev logging -----
  devLog("hypercore", hypercore, hlTimingMs, params);
  devLog("dex", dex, timingMs, params);
  devLog("ht", ht, timingMs, params);

  return { hypercore, dex, ht, midRef, timingMs };
}
