/**
 * Explainability Layer — Phase 8
 *
 * Transforms raw SOR results into human-readable quote responses
 * with full traceability.
 *
 * Provides:
 *   1. Route trace: step-by-step breakdown of each hop
 *   2. Alternatives: other routes considered (with relative difference)
 *   3. As-of block: which block the state was read at
 *   4. Warnings: aggregated from adapters + business rules
 *   5. Metadata: timing, pool count, split info
 */

import type { SplitResult, SplitAllocation } from "@/lib/router/split";
import type { EvaluatedRoute } from "@/lib/router/route/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExplainedQuote {
  /** Quote metadata */
  meta: {
    /** ISO timestamp of the quote */
    timestamp: string;
    /** Block number at which pool states were read */
    asOfBlock: string;
    /** How long the quote took to compute (ms) */
    computeTimeMs: number;
    /** Number of candidate routes considered */
    candidatesConsidered: number;
    /** Number of routes with viable quotes */
    viableRoutes: number;
    /** Whether the trade is split across routes */
    isSplit: boolean;
  };

  /** Input/output summary */
  summary: {
    tokenIn: string;
    tokenInSymbol: string;
    tokenInDecimals: number;
    tokenOut: string;
    tokenOutSymbol: string;
    tokenOutDecimals: number;
    amountIn: string;
    amountOut: string;
    /** Human-readable amounts */
    amountInFormatted: string;
    amountOutFormatted: string;
    /** Effective exchange rate */
    effectivePrice: number;
    /** Mid-market price (pre-trade) */
    midPrice: number;
    /** Price impact in basis points */
    priceImpactBps: number;
    /** Price impact as percentage string */
    priceImpactPct: string;
  };

  /** Route trace — step-by-step breakdown */
  routes: ExplainedRouteAllocation[];

  /** Alternative routes that were considered but not used */
  alternatives: ExplainedAlternative[];

  /** Aggregated warnings */
  warnings: string[];

  /** Fees breakdown */
  fees: { token: string; amount: string; symbol?: string }[];

  /** Split improvement info (only if isSplit) */
  splitInfo?: {
    /** Number of routes used */
    routeCount: number;
    /** Best single-route output */
    bestSingleRouteOutput: string;
    /** Improvement from splitting in bps */
    improvementBps: number;
    /** Improvement as percentage string */
    improvementPct: string;
  };
}

export interface ExplainedRouteAllocation {
  /** Allocation fraction (0..1) */
  fraction: number;
  /** Percentage string (e.g. "100%", "60%") */
  fractionPct: string;
  /** Amount allocated to this route */
  amountIn: string;
  /** Output from this route */
  amountOut: string;
  /** Hop-by-hop trace */
  hops: ExplainedHop[];
  /** Path label (e.g. "USDC → HYPE via KittenSwap") */
  pathLabel: string;
  /** Price impact for this route */
  priceImpactBps: number;
}

export interface ExplainedHop {
  /** Pool address */
  poolAddress: string;
  /** Protocol slug */
  protocol: string;
  /** Pool type (V2, V3, STABLE) */
  poolType: string;
  /** Input token */
  tokenIn: string;
  tokenInSymbol?: string;
  /** Output token */
  tokenOut: string;
  tokenOutSymbol?: string;
  /** Amount in */
  amountIn: string;
  /** Amount out */
  amountOut: string;
  /** Fee paid */
  fee: string;
  /** Price impact for this hop */
  priceImpactBps: number;
}

export interface ExplainedAlternative {
  /** Path description */
  pathLabel: string;
  /** Output amount */
  amountOut: string;
  /** Difference from best route in bps (negative = worse) */
  diffBps: number;
  /** Difference as percentage string */
  diffPct: string;
  /** Why this route was not chosen */
  reason: string;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface ExplainInput {
  tokenIn: string;
  tokenInSymbol: string;
  tokenInDecimals: number;
  tokenOut: string;
  tokenOutSymbol: string;
  tokenOutDecimals: number;
  amountIn: string;
  asOfBlock: bigint;
  computeTimeMs: number;
  splitResult: SplitResult;
  /** All evaluated routes (including ones not used in split) */
  allEvaluatedRoutes: EvaluatedRoute[];
}

/**
 * Build an explained quote from the SOR pipeline results.
 */
export function buildExplainedQuote(input: ExplainInput): ExplainedQuote {
  const {
    tokenIn,
    tokenInSymbol,
    tokenInDecimals,
    tokenOut,
    tokenOutSymbol,
    tokenOutDecimals,
    amountIn,
    asOfBlock,
    computeTimeMs,
    splitResult,
    allEvaluatedRoutes,
  } = input;

  // Format amounts
  const amountInFormatted = formatAmount(amountIn, tokenInDecimals);
  const amountOutFormatted = formatAmount(
    splitResult.amountOut,
    tokenOutDecimals
  );

  // Mid price from best single route
  const bestRoute =
    allEvaluatedRoutes.length > 0 ? allEvaluatedRoutes[0] : null;
  const midPrice = bestRoute?.hopQuotes[0]?.midPrice ?? 0;

  // Build route allocations
  const routes: ExplainedRouteAllocation[] = splitResult.allocations
    .filter((a) => a.quote)
    .map((a) => buildRouteAllocation(a));

  // Build alternatives (routes not in the allocation)
  const usedPaths = new Set(
    splitResult.allocations.map((a) => a.route.pathLabel)
  );
  const bestOutput = BigInt(splitResult.amountOut || "0");

  const alternatives: ExplainedAlternative[] = allEvaluatedRoutes
    .filter((r) => !usedPaths.has(r.route.pathLabel))
    .slice(0, 5)
    .map((r) => {
      const output = BigInt(r.amountOut);
      const diffBps =
        bestOutput > 0n
          ? Number(((output - bestOutput) * 10000n) / bestOutput)
          : 0;

      return {
        pathLabel: r.route.pathLabel,
        amountOut: r.amountOut,
        diffBps,
        diffPct: `${(diffBps / 100).toFixed(2)}%`,
        reason:
          diffBps < 0
            ? `${Math.abs(diffBps / 100).toFixed(2)}% less output`
            : "Lower score",
      };
    });

  // Aggregate warnings
  const warnings = [...splitResult.warnings];
  if (splitResult.priceImpactBps > 100) {
    warnings.push(
      `Overall price impact: ${(splitResult.priceImpactBps / 100).toFixed(2)}%`
    );
  }

  // Build split info
  let splitInfo: ExplainedQuote["splitInfo"];
  if (splitResult.isSplit) {
    splitInfo = {
      routeCount: splitResult.routeCount,
      bestSingleRouteOutput: splitResult.bestSingleRouteOutput,
      improvementBps: splitResult.splitImprovementBps,
      improvementPct: `${(splitResult.splitImprovementBps / 100).toFixed(2)}%`,
    };
  }

  return {
    meta: {
      timestamp: new Date().toISOString(),
      asOfBlock: asOfBlock.toString(),
      computeTimeMs,
      candidatesConsidered: allEvaluatedRoutes.length,
      viableRoutes: allEvaluatedRoutes.length,
      isSplit: splitResult.isSplit,
    },
    summary: {
      tokenIn,
      tokenInSymbol,
      tokenInDecimals,
      tokenOut,
      tokenOutSymbol,
      tokenOutDecimals,
      amountIn,
      amountOut: splitResult.amountOut,
      amountInFormatted,
      amountOutFormatted,
      effectivePrice: splitResult.effectivePrice,
      midPrice,
      priceImpactBps: splitResult.priceImpactBps,
      priceImpactPct: `${(splitResult.priceImpactBps / 100).toFixed(2)}%`,
    },
    routes,
    alternatives,
    warnings,
    fees: splitResult.totalFees,
    splitInfo,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRouteAllocation(
  allocation: SplitAllocation
): ExplainedRouteAllocation {
  const quote = allocation.quote!;
  const hops: ExplainedHop[] = allocation.route.hops.map((hop, i) => {
    const hopQuote = quote.hopQuotes[i];
    return {
      poolAddress: hop.pool.address,
      protocol: hop.pool.slug,
      poolType: hop.pool.poolType,
      tokenIn: hop.tokenIn,
      tokenOut: hop.tokenOut,
      amountIn: i === 0 ? allocation.amountIn : quote.hopQuotes[i - 1]?.amountOut ?? "0",
      amountOut: hopQuote?.amountOut ?? "0",
      fee: hopQuote?.feePaid[0]?.amount ?? "0",
      priceImpactBps: hopQuote?.priceImpactBps ?? 0,
    };
  });

  return {
    fraction: allocation.fraction,
    fractionPct: `${(allocation.fraction * 100).toFixed(0)}%`,
    amountIn: allocation.amountIn,
    amountOut: allocation.amountOut,
    hops,
    pathLabel: allocation.route.pathLabel,
    priceImpactBps: quote.priceImpactBps,
  };
}

function formatAmount(raw: string, decimals: number): string {
  if (!raw || raw === "0") return "0";

  const value = BigInt(raw);
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const frac = value % divisor;

  if (frac === 0n) return whole.toString();

  const fracStr = frac.toString().padStart(decimals, "0");
  // Trim trailing zeros, keep up to 6 significant decimals
  const trimmed = fracStr.replace(/0+$/, "").slice(0, 6);

  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}
