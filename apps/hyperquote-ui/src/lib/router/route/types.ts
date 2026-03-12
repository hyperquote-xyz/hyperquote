/**
 * Route Types — Phase 6
 *
 * Types for route generation and evaluation.
 * A "route" is a sequence of pool hops from tokenIn to tokenOut.
 */

import type { PoolContext, QuoteResult } from "@/lib/router/adapters/types";

// ---------------------------------------------------------------------------
// Route Hop
// ---------------------------------------------------------------------------

export interface RouteHop {
  /** Pool context for this hop */
  pool: PoolContext;
  /** Token entering this hop */
  tokenIn: string;
  /** Token exiting this hop */
  tokenOut: string;
}

// ---------------------------------------------------------------------------
// Candidate Route (pre-quote)
// ---------------------------------------------------------------------------

export interface CandidateRoute {
  /** Sequential hops from tokenIn to tokenOut */
  hops: RouteHop[];
  /** Number of hops (1 or 2) */
  hopCount: number;
  /** Intermediate token address (for 2-hop routes), null for direct */
  intermediateToken: string | null;
  /** Human-readable path description: "USDC → HYPE" or "USDC → HYPE → WETH" */
  pathLabel: string;
}

// ---------------------------------------------------------------------------
// Evaluated Route (post-quote)
// ---------------------------------------------------------------------------

export interface EvaluatedRoute {
  /** The candidate route */
  route: CandidateRoute;
  /** Final output amount (raw BigInt as string) */
  amountOut: string;
  /** Input amount (raw BigInt as string) */
  amountIn: string;
  /** Quote results for each hop */
  hopQuotes: QuoteResult[];
  /** Aggregate price impact in basis points */
  priceImpactBps: number;
  /** Aggregate effective price */
  effectivePrice: number;
  /** All fees paid across all hops */
  totalFees: { token: string; amount: string }[];
  /** All warnings from all hops */
  warnings: string[];
  /** Composite score for ranking (higher = better) */
  score: number;
}

// ---------------------------------------------------------------------------
// Route Generation Options
// ---------------------------------------------------------------------------

export interface RouteGenerationOptions {
  /** Maximum number of hops (default: 2) */
  maxHops?: number;
  /** Maximum candidate routes to evaluate (default: 20) */
  maxCandidates?: number;
  /** Maximum routes to return after pruning (default: 5) */
  maxRoutes?: number;
  /** Only consider pools with these statuses (default: ["ACTIVE"]) */
  poolStatuses?: string[];
  /** Only consider pools from these protocols */
  slugs?: string[];
  /** Exclude pools with TVL below this (in USD), default: 0 */
  minTvlUsd?: number;
}
