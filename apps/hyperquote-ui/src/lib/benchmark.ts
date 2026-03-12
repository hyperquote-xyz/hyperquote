/**
 * Universal Mid-Price Benchmark
 *
 * Provides a single source of truth for computing price impact / slippage
 * across all swap venues (HyperCore Spot, HyperEVM DEX, RFQ makers).
 *
 * Every venue's output is compared against the same HyperCore orderbook
 * mid-price reference so the "Slippage" numbers are directly comparable
 * and match Hyperliquid UI behavior.
 *
 * Mid-prices are derived from the HyperCore L2 orderbook via the same
 * 2s-cached proxy path used by simulateMarketBuy/Sell.
 *
 * Impact formulas:
 *   Exact-in:  (referenceOut − actualOut) / referenceOut × 100
 *   Exact-out: (actualIn − referenceIn) / referenceIn × 100
 */

import { Token } from "@/types";
import { tokenToHLCoin, USD_STABLES, getOrderbookMid } from "@/lib/hyperliquid";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Mid-price reference snapshot for benchmarking swap execution quality.
 *
 * `referenceOut` answers: "at the theoretical mid-price, how much tokenOut
 *  would I get for this amountIn?" (exact-in benchmark)
 *
 * `referenceIn` answers: "at the theoretical mid-price, how much tokenIn
 *  would I need to pay for this amountOut?" (exact-out benchmark)
 */
export interface MidPriceRef {
  /** USD mid-price of tokenIn (HyperCore orderbook mid, or 1.0 for stables) */
  priceIn: number;
  /** USD mid-price of tokenOut */
  priceOut: number;
  /** Ideal output at mid-price — for exact-in benchmark (tokenOut decimals) */
  referenceOut: bigint;
  /** Ideal input at mid-price — for exact-out benchmark (tokenIn decimals) */
  referenceIn: bigint;
  /** When the underlying prices were fetched (ms since epoch) */
  fetchedAt: number;
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

/**
 * Resolve a token's USD mid-price from HyperCore orderbook.
 * Stables are anchored at 1.0 (no orderbook fetch needed).
 * Returns null if the token has no HL spot market or the orderbook is empty.
 */
async function resolveTokenMid(token: Token): Promise<number | null> {
  if (USD_STABLES.has(token.symbol)) return 1.0;
  const coin = tokenToHLCoin(token);
  if (!coin) return null; // no HL spot market
  return getOrderbookMid(coin); // 2s-cached orderbook mid
}

// ---------------------------------------------------------------------------
// Core — fetch mid-price reference
// ---------------------------------------------------------------------------

/**
 * Compute the mid-price benchmark for a token pair.
 *
 * Derives mid-prices from HyperCore L2 orderbook (bestBid + bestAsk) / 2,
 * using the same 2s-cached proxy path as the venue simulation functions.
 * Stables (USDC, USDH, etc.) are treated as 1.0.
 *
 * @param amountIn  Raw bigint input amount (tokenIn decimals). Optional.
 * @param amountOut Raw bigint output amount (tokenOut decimals). Optional.
 * @returns MidPriceRef or null if either mid-price is unavailable.
 */
export async function getMidPriceRef(
  tokenIn: Token,
  tokenOut: Token,
  amountIn?: bigint,
  amountOut?: bigint,
): Promise<MidPriceRef | null> {
  // Resolve mid-prices from HyperCore orderbook (2s cache).
  // Stables are anchored at 1.0 — no orderbook fetch needed.
  const [priceIn, priceOut] = await Promise.all([
    resolveTokenMid(tokenIn),
    resolveTokenMid(tokenOut),
  ]);

  // Cannot compute a reference without both prices
  if (!priceIn || priceIn <= 0 || !priceOut || priceOut <= 0) return null;

  // Exchange rate: tokenOut per tokenIn at mid-price
  const rate = priceIn / priceOut;

  // referenceOut — ideal output for exact-in (conservative: floor)
  let referenceOut = 0n;
  if (amountIn && amountIn > 0n) {
    const normalizedIn = Number(amountIn) / 10 ** tokenIn.decimals;
    const idealOut = normalizedIn * rate;
    referenceOut = BigInt(Math.floor(idealOut * 10 ** tokenOut.decimals));
  }

  // referenceIn — ideal input for exact-out (conservative: ceil)
  let referenceIn = 0n;
  if (amountOut && amountOut > 0n) {
    const normalizedOut = Number(amountOut) / 10 ** tokenOut.decimals;
    const idealIn = normalizedOut / rate;
    referenceIn = BigInt(Math.ceil(idealIn * 10 ** tokenIn.decimals));
  }

  return {
    priceIn,
    priceOut,
    referenceOut,
    referenceIn,
    fetchedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Pure impact calculators
// ---------------------------------------------------------------------------

/**
 * Price impact for an exact-in swap.
 *
 * Positive → worse execution (got less than mid-price implies).
 * Clamped to ≥ 0: if a venue beats mid-price (e.g. stale cache,
 * favorable market move) we display 0.00% rather than negative slippage.
 */
export function impactExactIn(referenceOut: bigint, actualOut: bigint): number {
  if (referenceOut <= 0n) return 0;
  const pct = Number(referenceOut - actualOut) / Number(referenceOut) * 100;
  return Math.max(0, pct);
}

/**
 * Price impact for an exact-out swap.
 *
 * Positive → worse execution (paying more than mid-price implies).
 * Clamped to ≥ 0 for the same reason as above.
 */
export function impactExactOut(referenceIn: bigint, actualIn: bigint): number {
  if (referenceIn <= 0n) return 0;
  const pct = Number(actualIn - referenceIn) / Number(referenceIn) * 100;
  return Math.max(0, pct);
}
