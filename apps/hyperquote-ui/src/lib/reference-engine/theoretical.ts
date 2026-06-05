/**
 * Theoretical Reference — fair market value computation
 *
 * Represents the frictionless cross-rate: what you'd get at mid-price
 * with zero slippage. Used for price protection and quote validation.
 *
 * Source priority:
 * 1. HyperCore last traded price (most trusted)
 * 2. HT R1 aggregated market pricing
 * 3. PRJX pool pricing
 */

import type { MidPriceRef } from "@/lib/benchmark";

export interface TheoreticalRef {
  amountOut: number;
  /** Price of tokenIn in USD */
  priceIn: number;
  /** Price of tokenOut in USD */
  priceOut: number;
  /** Source used for the computation */
  source: "hypercore" | "ht" | "prjx";
  /** Human-readable source label */
  sourceLabel: string;
  /** Route description */
  routeDescription: string;
  /** 0–100 confidence score */
  confidence: number;
  confidenceLabel: string;
  /** Whether a valid theoretical was computed */
  available: boolean;
}

function confidenceLabel(score: number): string {
  if (score >= 90) return "High";
  if (score >= 70) return "Good";
  if (score >= 50) return "Moderate";
  if (score >= 30) return "Low";
  return "Very Low";
}

/**
 * Compute the theoretical fair value for a swap.
 *
 * Logic: amountIn × (priceIn / priceOut) = theoretical amountOut
 * This is a frictionless cross-rate — no slippage, no fees.
 *
 * Source cascade:
 * 1. HyperCore mid-price (from getMidPriceRef)
 * 2. HT R1 market pricing (from srcToken.price / dstToken.price)
 * 3. PRJX effective price (derived from quote amountOut)
 */
export function computeTheoretical(opts: {
  amountIn: number;
  midRef: MidPriceRef | null;
  htPriceIn: number | null;
  htPriceOut: number | null;
  prjxAmountOut: number | null;
}): TheoreticalRef {
  const { amountIn, midRef, htPriceIn, htPriceOut, prjxAmountOut } = opts;

  const unavailable: TheoreticalRef = {
    amountOut: 0, priceIn: 0, priceOut: 0,
    source: "hypercore", sourceLabel: "Reference unavailable",
    routeDescription: "Mid-price reference unavailable",
    confidence: 0, confidenceLabel: "Very Low", available: false,
  };

  if (amountIn <= 0) return unavailable;

  // Priority 1: HyperCore mid-price cross-rate
  if (midRef) {
    // Direct reference output (benchmark already computed cross-rate)
    if (midRef.referenceOut > 0n) {
      // Use the benchmark's computed reference — most accurate
      const theoreticalOut = Number(midRef.referenceOut) / 10 ** 18; // normalize if needed
      // But we want human-readable, so check priceIn/priceOut
      if (midRef.priceIn > 0 && midRef.priceOut > 0) {
        const crossRate = amountIn * midRef.priceIn / midRef.priceOut;
        return {
          amountOut: crossRate,
          priceIn: midRef.priceIn,
          priceOut: midRef.priceOut,
          source: "hypercore",
          sourceLabel: `Derived from last traded price on HyperCore`,
          routeDescription: `@ $${midRef.priceIn.toFixed(4)} / $${midRef.priceOut.toFixed(4)}`,
          confidence: 95,
          confidenceLabel: confidenceLabel(95),
          available: true,
        };
      }
    }

    // Fallback: individual USD prices from HC
    if (midRef.priceIn > 0 && midRef.priceOut > 0) {
      const crossRate = amountIn * midRef.priceIn / midRef.priceOut;
      return {
        amountOut: crossRate,
        priceIn: midRef.priceIn,
        priceOut: midRef.priceOut,
        source: "hypercore",
        sourceLabel: `Derived from last traded price on HyperCore`,
        routeDescription: `@ $${midRef.priceIn.toFixed(4)} / $${midRef.priceOut.toFixed(4)}`,
        confidence: 90,
        confidenceLabel: confidenceLabel(90),
        available: true,
      };
    }
  }

  // Priority 2: HT R1 market pricing
  if (htPriceIn && htPriceOut && htPriceIn > 0 && htPriceOut > 0) {
    const crossRate = amountIn * htPriceIn / htPriceOut;
    return {
      amountOut: crossRate,
      priceIn: htPriceIn,
      priceOut: htPriceOut,
      source: "ht",
      sourceLabel: `Derived from aggregated market pricing`,
      routeDescription: `@ $${htPriceIn.toFixed(4)} / $${htPriceOut.toFixed(4)}`,
      confidence: 75,
      confidenceLabel: confidenceLabel(75),
      available: true,
    };
  }

  // Priority 3: PRJX pool pricing (derive from quote output)
  if (prjxAmountOut && prjxAmountOut > 0 && amountIn > 0) {
    // PRJX includes slippage/fees, so this is slightly less accurate than mid-price
    return {
      amountOut: prjxAmountOut,
      priceIn: 0,
      priceOut: 0,
      source: "prjx",
      sourceLabel: `Derived from PRJX pool pricing`,
      routeDescription: `Based on on-chain pool state`,
      confidence: 60,
      confidenceLabel: confidenceLabel(60),
      available: true,
    };
  }

  return unavailable;
}
