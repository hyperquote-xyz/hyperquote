/**
 * V2 Adapter — Phase 5A
 *
 * Implements constant-product (x * y = k) swap simulation for
 * Uniswap V2, Velodrome, and Solidly-style pools.
 *
 * Formula (exact-in):
 *   amountInWithFee = amountIn * (10000 - feeBps)
 *   amountOut = (amountInWithFee * reserveOut) / (reserveIn * 10000 + amountInWithFee)
 *
 * Default fee: 30 bps (0.3%) for standard V2, 1 bps for stable Velodrome pools.
 *
 * Price impact:
 *   midPrice = reserveOut / reserveIn
 *   execPrice = amountOut / amountIn
 *   impact = 1 - (execPrice / midPrice)
 */

import type { PoolState, V2PoolState } from "@/lib/router/state/types";
import type { PoolAdapter, QuoteResult } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default fee for standard V2 AMMs (0.3%) */
const DEFAULT_V2_FEE_BPS = 30;
/** Default fee for Velodrome stable pools */
const STABLE_FEE_BPS = 1;
/** Fee denominator */
const FEE_DENOM = 10000n;

// ---------------------------------------------------------------------------
// V2 Adapter
// ---------------------------------------------------------------------------

export const v2Adapter: PoolAdapter = {
  supportedTypes: ["V2"],

  quoteExactIn(
    state: PoolState,
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    token0: string,
    token1: string,
    decimals0: number,
    decimals1: number
  ): QuoteResult | null {
    if (state.type !== "V2") return null;

    const v2 = state as V2PoolState;
    const reserve0 = BigInt(v2.reserve0);
    const reserve1 = BigInt(v2.reserve1);

    if (reserve0 === 0n || reserve1 === 0n) {
      return null; // empty pool
    }

    // Determine direction (all addresses are canonical lowercase)
    const isZeroToOne = tokenIn === token0;
    const isOneToZero = tokenIn === token1;

    if (!isZeroToOne && !isOneToZero) {
      return null; // token not in pool
    }

    const reserveIn = isZeroToOne ? reserve0 : reserve1;
    const reserveOut = isZeroToOne ? reserve1 : reserve0;
    const decimalsIn = isZeroToOne ? decimals0 : decimals1;
    const decimalsOut = isZeroToOne ? decimals1 : decimals0;

    const input = BigInt(amountIn);
    if (input <= 0n) return null;

    // Fee
    const feeBps = v2.isStable ? STABLE_FEE_BPS : DEFAULT_V2_FEE_BPS;
    const feeFactor = FEE_DENOM - BigInt(feeBps);

    // Constant-product swap
    const amountInWithFee = input * feeFactor;
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn * FEE_DENOM + amountInWithFee;
    const amountOut = numerator / denominator;

    if (amountOut <= 0n || amountOut >= reserveOut) {
      return {
        amountOut: "0",
        feePaid: [],
        priceImpactBps: 10000,
        effectivePrice: 0,
        midPrice: 0,
        warnings: ["Insufficient liquidity — output exceeds reserves"],
      };
    }

    // Fee amount (in input token)
    const feeAmount = (input * BigInt(feeBps)) / FEE_DENOM;

    // Price calculations (in human-readable units)
    const scale0 = 10 ** decimalsIn;
    const scale1 = 10 ** decimalsOut;

    // Mid price: reserveOut/reserveIn (adjusted for decimals)
    const midPrice =
      (Number(reserveOut) / scale1) / (Number(reserveIn) / scale0);

    // Effective price: amountOut/amountIn
    const effectivePrice =
      (Number(amountOut) / scale1) / (Number(input) / scale0);

    // Price impact in bps
    const priceImpactBps =
      midPrice > 0
        ? Math.round((1 - effectivePrice / midPrice) * 10000)
        : 0;

    // Warnings
    const warnings: string[] = [];
    if (priceImpactBps > 500) {
      warnings.push(`High price impact: ${(priceImpactBps / 100).toFixed(2)}%`);
    }
    if (amountOut * 2n > reserveOut) {
      warnings.push("Trade size exceeds 50% of pool reserves");
    }

    return {
      amountOut: amountOut.toString(),
      feePaid: [
        {
          token: tokenIn,
          amount: feeAmount.toString(),
        },
      ],
      priceImpactBps: Math.max(0, priceImpactBps),
      effectivePrice,
      midPrice,
      warnings,
    };
  },
};
