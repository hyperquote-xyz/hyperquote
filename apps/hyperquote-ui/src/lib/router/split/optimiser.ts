/**
 * Split Optimiser — Phase 7
 *
 * Greedy marginal allocator that splits a trade across multiple routes
 * to minimise price impact and maximise total output.
 *
 * Strategy:
 *   1. Start with the top K routes from Phase 6
 *   2. Divide amountIn into N steps (e.g. 10% increments)
 *   3. For each step, simulate adding the marginal chunk to each route
 *   4. Allocate the chunk to whichever route produces the best marginal output
 *   5. Repeat until all input is allocated
 *
 * The result is an allocation map: route → fraction of total input.
 *
 * Why greedy (not full optimisation)?
 *   - O(K × N) vs O(K^N) — fast enough for real-time quotes
 *   - Good approximation when routes have diminishing marginal returns
 *   - Simple, deterministic, easy to explain
 *
 * State-Aware:
 *   Each route simulation re-evaluates with the cumulative allocated amount,
 *   so the marginal output accounts for the reserves already consumed by
 *   previous allocations to the same route.
 */

import { evaluateRoute } from "@/lib/router/route/generator";
import type { CandidateRoute, EvaluatedRoute } from "@/lib/router/route/types";
import type { QuoteResult } from "@/lib/router/adapters/types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Default number of allocation steps */
const DEFAULT_STEPS = 10;

/** Maximum routes to split across */
const DEFAULT_MAX_SPLIT_ROUTES = 4;

/** Minimum allocation per route (as fraction, e.g. 0.05 = 5%) */
const MIN_ALLOCATION_FRACTION = 0.01;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SplitAllocation {
  /** The candidate route */
  route: CandidateRoute;
  /** Fraction of total input allocated (0..1) */
  fraction: number;
  /** Absolute input amount allocated (raw BigInt as string) */
  amountIn: string;
  /** Output amount from this allocation (raw BigInt as string) */
  amountOut: string;
  /** Quote details for this allocation */
  quote: EvaluatedRoute | null;
}

export interface SplitResult {
  /** Total input amount */
  amountIn: string;
  /** Total output across all routes */
  amountOut: string;
  /** Whether the trade was split across multiple routes */
  isSplit: boolean;
  /** Number of routes used */
  routeCount: number;
  /** Allocation per route */
  allocations: SplitAllocation[];
  /** Aggregate price impact (weighted by allocation) */
  priceImpactBps: number;
  /** Aggregate effective price */
  effectivePrice: number;
  /** All fees across all routes */
  totalFees: { token: string; amount: string }[];
  /** All warnings */
  warnings: string[];
  /** Best single-route output (for comparison) */
  bestSingleRouteOutput: string;
  /** Improvement from splitting (bps, e.g. 50 = 0.5% better) */
  splitImprovementBps: number;
}

export interface SplitOptions {
  /** Number of allocation steps (default: 10) */
  steps?: number;
  /** Max routes to split across (default: 4) */
  maxSplitRoutes?: number;
  /** Minimum allocation fraction per route (default: 0.01) */
  minAllocationFraction?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Divide a BigInt amount into a fraction.
 */
function fractionOf(amount: string, numerator: number, denominator: number): string {
  const a = BigInt(amount);
  return ((a * BigInt(Math.round(numerator * 1e6))) / BigInt(Math.round(denominator * 1e6))).toString();
}

/**
 * Add two BigInt strings.
 */
function addBigInt(a: string, b: string): string {
  return (BigInt(a) + BigInt(b)).toString();
}

// ---------------------------------------------------------------------------
// Greedy Marginal Allocator
// ---------------------------------------------------------------------------

/**
 * Optimise split across candidate routes using greedy marginal allocation.
 *
 * @param candidates — Top candidate routes from Phase 6 (already ranked)
 * @param amountIn — Total input amount (raw BigInt as string)
 * @param options — Split configuration
 */
export function optimiseSplit(
  candidates: CandidateRoute[],
  amountIn: string,
  options?: SplitOptions
): SplitResult {
  const steps = options?.steps ?? DEFAULT_STEPS;
  const maxSplitRoutes = options?.maxSplitRoutes ?? DEFAULT_MAX_SPLIT_ROUTES;
  const minFraction = options?.minAllocationFraction ?? MIN_ALLOCATION_FRACTION;

  const totalInput = BigInt(amountIn);
  if (totalInput <= 0n || candidates.length === 0) {
    return emptyResult(amountIn);
  }

  // Limit candidates to maxSplitRoutes
  const routes = candidates.slice(0, maxSplitRoutes);

  // Track cumulative allocation per route (in steps)
  const allocatedSteps: number[] = new Array(routes.length).fill(0);
  const stepSize = 1; // Each step = 1/steps of total

  // Greedy: allocate one step at a time
  for (let s = 0; s < steps; s++) {
    let bestRouteIdx = -1;
    let bestMarginalOutput = 0n;

    for (let r = 0; r < routes.length; r++) {
      const newSteps = allocatedSteps[r] + stepSize;
      const candidateAmountIn = fractionOf(amountIn, newSteps, steps);

      // Evaluate this route with the candidate total allocation
      const evaluated = evaluateRoute(routes[r], candidateAmountIn);
      if (!evaluated) continue;

      // Previous output with current allocation
      let prevOutput = 0n;
      if (allocatedSteps[r] > 0) {
        const prevAmountIn = fractionOf(amountIn, allocatedSteps[r], steps);
        const prevEval = evaluateRoute(routes[r], prevAmountIn);
        if (prevEval) {
          prevOutput = BigInt(prevEval.amountOut);
        }
      }

      // Marginal output = new total output - previous total output
      const marginalOutput = BigInt(evaluated.amountOut) - prevOutput;

      if (marginalOutput > bestMarginalOutput) {
        bestMarginalOutput = marginalOutput;
        bestRouteIdx = r;
      }
    }

    if (bestRouteIdx === -1) break; // no viable route
    allocatedSteps[bestRouteIdx] += stepSize;
  }

  // Build final allocations
  const allocations: SplitAllocation[] = [];
  let totalOut = 0n;
  let weightedImpact = 0;
  const allFees: { token: string; amount: string }[] = [];
  const allWarnings: string[] = [];

  for (let r = 0; r < routes.length; r++) {
    if (allocatedSteps[r] === 0) continue;

    const fraction = allocatedSteps[r] / steps;
    if (fraction < minFraction) continue; // skip negligible allocations

    const routeAmountIn = fractionOf(amountIn, allocatedSteps[r], steps);
    const evaluated = evaluateRoute(routes[r], routeAmountIn);

    allocations.push({
      route: routes[r],
      fraction,
      amountIn: routeAmountIn,
      amountOut: evaluated?.amountOut ?? "0",
      quote: evaluated,
    });

    if (evaluated) {
      totalOut += BigInt(evaluated.amountOut);
      weightedImpact += evaluated.priceImpactBps * fraction;
      allFees.push(...evaluated.totalFees);
      allWarnings.push(...evaluated.warnings);
    }
  }

  // Handle rounding: ensure allocated amounts sum to total
  // (any remainder goes to the best route)
  const allocatedTotal = allocations.reduce(
    (sum, a) => sum + BigInt(a.amountIn),
    0n
  );
  const remainder = totalInput - allocatedTotal;
  if (remainder > 0n && allocations.length > 0) {
    // Add remainder to the first (best) allocation
    allocations[0].amountIn = addBigInt(
      allocations[0].amountIn,
      remainder.toString()
    );
    // Re-evaluate with corrected amount
    const corrected = evaluateRoute(
      allocations[0].route,
      allocations[0].amountIn
    );
    if (corrected) {
      // Adjust total output
      totalOut =
        totalOut -
        BigInt(allocations[0].amountOut) +
        BigInt(corrected.amountOut);
      allocations[0].amountOut = corrected.amountOut;
      allocations[0].quote = corrected;
    }
  }

  // Best single-route for comparison
  let bestSingleOutput = 0n;
  for (const route of routes) {
    const single = evaluateRoute(route, amountIn);
    if (single && BigInt(single.amountOut) > bestSingleOutput) {
      bestSingleOutput = BigInt(single.amountOut);
    }
  }

  const splitImprovement =
    bestSingleOutput > 0n
      ? Number(
          ((totalOut - bestSingleOutput) * 10000n) / bestSingleOutput
        )
      : 0;

  // Effective price (for the overall trade)
  const lastAllocation = allocations.find((a) => a.quote);
  const effectivePrice = lastAllocation?.quote?.effectivePrice ?? 0;

  return {
    amountIn,
    amountOut: totalOut.toString(),
    isSplit: allocations.length > 1,
    routeCount: allocations.length,
    allocations,
    priceImpactBps: Math.round(weightedImpact),
    effectivePrice,
    totalFees: allFees,
    warnings: allWarnings,
    bestSingleRouteOutput: bestSingleOutput.toString(),
    splitImprovementBps: Math.max(0, splitImprovement),
  };
}

// ---------------------------------------------------------------------------
// Empty Result
// ---------------------------------------------------------------------------

function emptyResult(amountIn: string): SplitResult {
  return {
    amountIn,
    amountOut: "0",
    isSplit: false,
    routeCount: 0,
    allocations: [],
    priceImpactBps: 0,
    effectivePrice: 0,
    totalFees: [],
    warnings: ["No viable routes found"],
    bestSingleRouteOutput: "0",
    splitImprovementBps: 0,
  };
}
