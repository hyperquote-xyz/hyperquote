/**
 * Adapter Types — Phase 5
 *
 * Standard interface for all pool type adapters.
 * Each adapter takes a pool state snapshot + trade parameters
 * and returns the simulated output with fee/impact data.
 */

import type { PoolState } from "@/lib/router/state/types";

// ---------------------------------------------------------------------------
// Quote Result
// ---------------------------------------------------------------------------

export interface QuoteResult {
  /** Output amount after fees (raw BigInt as string) */
  amountOut: string;
  /** Fees paid during the swap */
  feePaid: {
    /** Token address the fee is denominated in */
    token: string;
    /** Fee amount (raw BigInt as string) */
    amount: string;
  }[];
  /** Price impact in basis points (100 bps = 1%) */
  priceImpactBps: number;
  /** Effective exchange rate (amountOut / amountIn, in human-readable terms) */
  effectivePrice: number;
  /** Mid-market price before the trade */
  midPrice: number;
  /** Warnings about the quote (e.g. "crosses N ticks", "high impact") */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Adapter Interface
// ---------------------------------------------------------------------------

export interface PoolAdapter {
  /** Which pool type(s) this adapter handles */
  supportedTypes: string[];

  /**
   * Simulate an exact-input swap.
   *
   * @param state     — The pool's current state snapshot
   * @param tokenIn   — Address of the input token
   * @param tokenOut  — Address of the output token
   * @param amountIn  — Raw input amount (BigInt as string)
   * @param token0    — Address of pool's token0
   * @param token1    — Address of pool's token1
   * @param decimals0 — Decimals of token0
   * @param decimals1 — Decimals of token1
   * @returns QuoteResult or null if the swap cannot be simulated
   */
  quoteExactIn(
    state: PoolState,
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    token0: string,
    token1: string,
    decimals0: number,
    decimals1: number
  ): QuoteResult | null;
}

// ---------------------------------------------------------------------------
// Pool Context (used by the route engine to pass to adapters)
// ---------------------------------------------------------------------------

export interface PoolContext {
  poolId: string;
  address: string;
  slug: string;
  poolType: string;
  token0: string;
  token1: string;
  decimals0: number;
  decimals1: number;
  feeBps: number | null;
  tickSpacing: number | null;
  state: PoolState;
  stateBlock: bigint;
}
