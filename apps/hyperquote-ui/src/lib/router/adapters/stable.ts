/**
 * Stable Adapter — Phase 5
 *
 * Implements Solidly/Velodrome-style stable swap simulation.
 *
 * Velodrome stable pools use a modified invariant:
 *   x³y + xy³ = k   (rather than Curve's D-based invariant)
 *
 * This provides lower slippage for same-value assets (stablecoins, LSTs).
 *
 * The swap formula is solved numerically using Newton's method.
 *
 * For V2PoolState with isStable=true (Velodrome/KittenSwap stable pools):
 *   We use the x³y + xy³ = k invariant with the reserves from getReserves().
 */

import type { PoolState, V2PoolState } from "@/lib/router/state/types";
import type { PoolAdapter, QuoteResult } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default fee for Velodrome stable pools (0.01%) */
const STABLE_FEE_BPS = 1;
const FEE_DENOM = 10000n;

// ---------------------------------------------------------------------------
// Solidly Stable Math
// ---------------------------------------------------------------------------

/**
 * Compute k = x³y + xy³ for the Solidly stable invariant.
 * All values are normalised to 18 decimals before computation.
 */
function getK(x: bigint, y: bigint): bigint {
  const xy = (x * y) / 10n ** 18n;
  const x2y2 = (x * x) / 10n ** 18n + (y * y) / 10n ** 18n;
  // k = xy * (x² + y²) / 1e18
  return (xy * x2y2) / 10n ** 18n;
}

/**
 * Get output amount for the Solidly stable invariant using Newton's method.
 *
 * Given reserves x, y and input dx:
 *   Find dy such that k(x + dx, y - dy) = k(x, y)
 *
 * @param reserveIn  — normalised reserve of input token (18 dec)
 * @param reserveOut — normalised reserve of output token (18 dec)
 * @param amountIn   — normalised input amount (18 dec)
 * @returns normalised output amount (18 dec)
 */
function getStableAmountOut(
  reserveIn: bigint,
  reserveOut: bigint,
  amountIn: bigint
): bigint {
  const newReserveIn = reserveIn + amountIn;
  const k = getK(reserveIn, reserveOut);

  // Newton's method to find y such that getK(newReserveIn, y) = k
  let y = reserveOut; // initial guess

  for (let i = 0; i < 255; i++) {
    const kCurrent = getK(newReserveIn, y);
    if (kCurrent === k) break;

    // f(y) = getK(newReserveIn, y) - k
    // f'(y) = d/dy [x³y + xy³] = x³ + 3xy²
    const x = newReserveIn;
    const x3 = (x * x * x) / (10n ** 18n * 10n ** 18n);
    const xy2 = (x * y * y) / (10n ** 18n * 10n ** 18n);
    const fPrime = x3 + 3n * xy2;

    if (fPrime === 0n) break;

    const fValue = kCurrent - k;
    const delta = (fValue * 10n ** 18n) / fPrime;

    if (delta === 0n) break;

    if (fValue > 0n) {
      y -= delta;
    } else {
      y += (-delta);
    }

    // Safety: y must be positive
    if (y <= 0n) {
      y = 1n;
    }
  }

  const amountOut = reserveOut - y;
  return amountOut > 0n ? amountOut : 0n;
}

// ---------------------------------------------------------------------------
// Stable Adapter
// ---------------------------------------------------------------------------

export const stableAdapter: PoolAdapter = {
  supportedTypes: ["STABLE"],

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
    // Stable pools come through as V2PoolState with isStable=true
    if (state.type !== "V2") return null;
    const v2 = state as V2PoolState;

    const reserve0Raw = BigInt(v2.reserve0);
    const reserve1Raw = BigInt(v2.reserve1);

    if (reserve0Raw === 0n || reserve1Raw === 0n) return null;

    // Direction (all addresses are canonical lowercase)
    const isZeroToOne = tokenIn === token0;
    const isOneToZero = tokenIn === token1;
    if (!isZeroToOne && !isOneToZero) return null;

    const input = BigInt(amountIn);
    if (input <= 0n) return null;

    const decimalsIn = isZeroToOne ? decimals0 : decimals1;
    const decimalsOut = isZeroToOne ? decimals1 : decimals0;
    const reserveInRaw = isZeroToOne ? reserve0Raw : reserve1Raw;
    const reserveOutRaw = isZeroToOne ? reserve1Raw : reserve0Raw;

    // Deduct fee
    const feeAmount = (input * BigInt(STABLE_FEE_BPS)) / FEE_DENOM;
    const inputAfterFee = input - feeAmount;

    // Normalise to 18 decimals for invariant math
    const scale18In = 10n ** BigInt(18 - decimalsIn);
    const scale18Out = 10n ** BigInt(18 - decimalsOut);

    const reserveInNorm = reserveInRaw * scale18In;
    const reserveOutNorm = reserveOutRaw * scale18Out;
    const amountInNorm = inputAfterFee * scale18In;

    // Compute output using Solidly stable invariant
    const amountOutNorm = getStableAmountOut(
      reserveInNorm,
      reserveOutNorm,
      amountInNorm
    );

    // De-normalise back to output token decimals
    const amountOut = amountOutNorm / scale18Out;

    if (amountOut <= 0n) {
      return null;
    }

    // Price calculations
    const scaleIn = 10 ** decimalsIn;
    const scaleOut = 10 ** decimalsOut;

    // For stable pools, mid-price should be ~1:1 (adjusted for decimals)
    const midPrice =
      (Number(reserveOutRaw) / scaleOut) / (Number(reserveInRaw) / scaleIn);
    const effectivePrice =
      (Number(amountOut) / scaleOut) / (Number(input) / scaleIn);
    const priceImpactBps =
      midPrice > 0
        ? Math.round((1 - effectivePrice / midPrice) * 10000)
        : 0;

    const warnings: string[] = [];
    if (priceImpactBps > 50) {
      warnings.push(
        `Price impact: ${(priceImpactBps / 100).toFixed(2)}% (unusual for stable pool)`
      );
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
