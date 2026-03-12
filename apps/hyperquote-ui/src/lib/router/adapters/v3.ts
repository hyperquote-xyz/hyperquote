/**
 * V3 Adapter — Phase 5B
 *
 * Implements Uniswap V3-style concentrated liquidity swap simulation.
 *
 * The simulation traverses tick ranges, consuming liquidity at each step.
 * For each tick range:
 *   1. Compute the max amount that can be swapped within this range
 *   2. If amountIn exhausted within range, compute final output
 *   3. If amountIn exceeds range, cross the tick boundary and continue
 *
 * Key math (exact-in, zero-to-one):
 *   Within a tick range [lower, upper] with liquidity L:
 *   Δ(1/√P) = amountIn / L            (how much price moves)
 *   amountOut = L * Δ(√P)              (output received)
 *
 * Fee is deducted from amountIn before the swap step.
 */

import type { PoolState, V3PoolState, TickData } from "@/lib/router/state/types";
import type { PoolAdapter, QuoteResult } from "./types";
import {
  getSqrtPriceAtTick,
  MIN_SQRT_PRICE,
  MAX_SQRT_PRICE,
} from "./tick-math";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Q96 = 2^96 (for fixed-point sqrt price) */
const Q96 = 2n ** 96n;

/** Q192 = 2^192 */
const Q192 = Q96 * Q96;

/** Fee denominator (V3 fees are in 1/1_000_000) */
const FEE_UNITS = 1_000_000n;

/**
 * Compute amount0 for a price move (token0 is x-axis).
 * amount0 = L * (1/sqrtPriceA - 1/sqrtPriceB)
 * where sqrtPriceA < sqrtPriceB
 */
function getAmount0Delta(
  sqrtPriceA: bigint,
  sqrtPriceB: bigint,
  liquidity: bigint
): bigint {
  let lower = sqrtPriceA;
  let upper = sqrtPriceB;
  if (lower > upper) [lower, upper] = [upper, lower];

  if (lower <= 0n) return 0n;

  // amount0 = L * Q96 * (upper - lower) / (lower * upper)
  return (liquidity * Q96 * (upper - lower)) / (lower * upper);
}

/**
 * Compute amount1 for a price move (token1 is y-axis).
 * amount1 = L * (sqrtPriceB - sqrtPriceA)
 */
function getAmount1Delta(
  sqrtPriceA: bigint,
  sqrtPriceB: bigint,
  liquidity: bigint
): bigint {
  let lower = sqrtPriceA;
  let upper = sqrtPriceB;
  if (lower > upper) [lower, upper] = [upper, lower];

  // amount1 = L * (upper - lower) / Q96
  return (liquidity * (upper - lower)) / Q96;
}

// ---------------------------------------------------------------------------
// V3 Adapter
// ---------------------------------------------------------------------------

export const v3Adapter: PoolAdapter = {
  supportedTypes: ["V3"],

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
    if (state.type !== "V3") return null;

    const v3 = state as V3PoolState;
    const sqrtPriceX96 = BigInt(v3.sqrtPriceX96);
    let currentLiquidity = BigInt(v3.liquidity);
    let currentTick = v3.tick;
    let currentSqrtPrice = sqrtPriceX96;
    const fee = BigInt(v3.fee);

    if (currentLiquidity === 0n && v3.ticksWindow.length === 0) {
      return null; // completely empty pool
    }

    // Direction (all addresses are canonical lowercase)
    const zeroForOne = tokenIn === token0;
    const oneForZero = tokenIn === token1;

    if (!zeroForOne && !oneForZero) return null;

    const decimalsIn = zeroForOne ? decimals0 : decimals1;
    const decimalsOut = zeroForOne ? decimals1 : decimals0;

    let amountRemaining = BigInt(amountIn);
    let amountOutTotal = 0n;
    let totalFee = 0n;
    let ticksCrossed = 0;

    if (amountRemaining <= 0n) return null;

    // Sort ticks for traversal
    const ticks = [...v3.ticksWindow].sort((a, b) =>
      zeroForOne ? b.tick - a.tick : a.tick - b.tick
    );

    // Price limit
    const sqrtPriceLimit = zeroForOne
      ? MIN_SQRT_PRICE + 1n
      : MAX_SQRT_PRICE - 1n;

    // Maximum iterations to prevent infinite loops
    const MAX_STEPS = 200;
    let step = 0;

    while (amountRemaining > 0n && step < MAX_STEPS) {
      step++;

      // Find next initialized tick in the direction of travel
      let nextTick: TickData | undefined;
      if (zeroForOne) {
        // Price decreasing — find next tick below current
        nextTick = ticks.find((t) => t.tick < currentTick);
      } else {
        // Price increasing — find next tick above current
        nextTick = ticks.find((t) => t.tick >= currentTick);
      }

      // Target sqrt price (either next tick or price limit)
      let sqrtPriceTarget: bigint;
      if (nextTick) {
        sqrtPriceTarget = getSqrtPriceAtTick(nextTick.tick);
        // Clamp to price limit
        if (zeroForOne && sqrtPriceTarget < sqrtPriceLimit) {
          sqrtPriceTarget = sqrtPriceLimit;
        }
        if (!zeroForOne && sqrtPriceTarget > sqrtPriceLimit) {
          sqrtPriceTarget = sqrtPriceLimit;
        }
      } else {
        sqrtPriceTarget = sqrtPriceLimit;
      }

      if (currentLiquidity === 0n) {
        // No liquidity in this range — skip to next tick
        if (!nextTick) break; // no more ticks
        currentTick = nextTick.tick + (zeroForOne ? -1 : 0);
        currentSqrtPrice = getSqrtPriceAtTick(nextTick.tick);

        // Cross tick — update liquidity
        const liquidityNet = BigInt(nextTick.liquidityNet);
        currentLiquidity += zeroForOne ? -liquidityNet : liquidityNet;
        if (currentLiquidity < 0n) currentLiquidity = 0n;
        ticksCrossed++;

        // Remove this tick from future consideration
        const idx = ticks.indexOf(nextTick);
        if (idx >= 0) ticks.splice(idx, 1);
        continue;
      }

      // Deduct fee from remaining input
      const feeAmount = (amountRemaining * fee) / FEE_UNITS;
      const amountInAfterFee = amountRemaining - feeAmount;

      // Compute how much input the current tick range can absorb
      let maxAmountIn: bigint;
      let amountOutStep: bigint;

      if (zeroForOne) {
        // Selling token0 → price decreases
        // Max amount0 that moves price from current to target
        maxAmountIn = getAmount0Delta(
          sqrtPriceTarget,
          currentSqrtPrice,
          currentLiquidity
        );

        if (amountInAfterFee >= maxAmountIn) {
          // Fully traverse this range
          amountOutStep = getAmount1Delta(
            sqrtPriceTarget,
            currentSqrtPrice,
            currentLiquidity
          );
          const actualFee = ((maxAmountIn * FEE_UNITS) / (FEE_UNITS - fee)) - maxAmountIn;
          amountRemaining -= maxAmountIn + actualFee;
          totalFee += actualFee;
          currentSqrtPrice = sqrtPriceTarget;
        } else {
          // Partially traverse — compute new sqrt price
          // newSqrtPrice = (L * sqrtPrice) / (L + amount0 * sqrtPrice)
          const numerator = currentLiquidity * currentSqrtPrice;
          const denominator = currentLiquidity + (amountInAfterFee * currentSqrtPrice) / Q96;
          if (denominator <= 0n) break;
          const newSqrtPrice = (numerator * Q96) / (denominator * Q96 / Q96);

          amountOutStep = getAmount1Delta(
            newSqrtPrice,
            currentSqrtPrice,
            currentLiquidity
          );
          totalFee += feeAmount;
          amountRemaining = 0n;
          currentSqrtPrice = newSqrtPrice;
        }
      } else {
        // Selling token1 → price increases
        maxAmountIn = getAmount1Delta(
          currentSqrtPrice,
          sqrtPriceTarget,
          currentLiquidity
        );

        if (amountInAfterFee >= maxAmountIn) {
          amountOutStep = getAmount0Delta(
            currentSqrtPrice,
            sqrtPriceTarget,
            currentLiquidity
          );
          const actualFee = ((maxAmountIn * FEE_UNITS) / (FEE_UNITS - fee)) - maxAmountIn;
          amountRemaining -= maxAmountIn + actualFee;
          totalFee += actualFee;
          currentSqrtPrice = sqrtPriceTarget;
        } else {
          // New sqrt price = currentSqrtPrice + amountIn / L
          const deltaSqrtPrice = (amountInAfterFee * Q96) / currentLiquidity;
          const newSqrtPrice = currentSqrtPrice + deltaSqrtPrice;

          amountOutStep = getAmount0Delta(
            currentSqrtPrice,
            newSqrtPrice,
            currentLiquidity
          );
          totalFee += feeAmount;
          amountRemaining = 0n;
          currentSqrtPrice = newSqrtPrice;
        }
      }

      amountOutTotal += amountOutStep;

      // Cross tick if we reached the target and it was a tick boundary
      if (
        currentSqrtPrice === sqrtPriceTarget &&
        nextTick &&
        sqrtPriceTarget !== sqrtPriceLimit
      ) {
        const liquidityNet = BigInt(nextTick.liquidityNet);
        currentLiquidity += zeroForOne ? -liquidityNet : liquidityNet;
        if (currentLiquidity < 0n) currentLiquidity = 0n;
        currentTick = nextTick.tick + (zeroForOne ? -1 : 0);
        ticksCrossed++;

        // Remove crossed tick
        const idx = ticks.indexOf(nextTick);
        if (idx >= 0) ticks.splice(idx, 1);
      }

      // Safety: if we hit the price limit, stop
      if (currentSqrtPrice === sqrtPriceLimit) break;
    }

    if (amountOutTotal <= 0n) {
      return null;
    }

    // Price impact calculation
    const scale0 = 10 ** decimalsIn;
    const scale1 = 10 ** decimalsOut;
    const input = BigInt(amountIn);

    // Mid price from initial sqrt price
    // For zeroForOne: midPrice = (sqrtPriceX96 / Q96)^2 * (10^decimals0 / 10^decimals1)
    const sqrtPriceFloat = Number(sqrtPriceX96) / Number(Q96);
    const rawPrice = sqrtPriceFloat * sqrtPriceFloat;

    let midPrice: number;
    let effectivePrice: number;

    if (zeroForOne) {
      // Price of token0 in terms of token1
      midPrice = rawPrice * (scale0 / scale1);
      effectivePrice =
        (Number(amountOutTotal) / scale1) / (Number(input) / scale0);
    } else {
      // Price of token1 in terms of token0
      midPrice = (1 / rawPrice) * (scale1 / scale0);
      effectivePrice =
        (Number(amountOutTotal) / scale0) / (Number(input) / scale1);
    }

    const priceImpactBps =
      midPrice > 0
        ? Math.round((1 - effectivePrice / midPrice) * 10000)
        : 0;

    // Warnings
    const warnings: string[] = [];
    if (ticksCrossed > 0) {
      warnings.push(`Crosses ${ticksCrossed} tick${ticksCrossed > 1 ? "s" : ""}`);
    }
    if (priceImpactBps > 500) {
      warnings.push(
        `High price impact: ${(priceImpactBps / 100).toFixed(2)}%`
      );
    }
    if (amountRemaining > 0n) {
      warnings.push(
        "Insufficient liquidity — only partial fill " +
          `(${((1 - Number(amountRemaining) / Number(input)) * 100).toFixed(1)}% filled)`
      );
    }
    if (step >= 200) {
      warnings.push("Max tick traversal steps reached");
    }

    return {
      amountOut: amountOutTotal.toString(),
      feePaid: [
        {
          token: tokenIn,
          amount: totalFee.toString(),
        },
      ],
      priceImpactBps: Math.max(0, priceImpactBps),
      effectivePrice,
      midPrice,
      warnings,
    };
  },
};
