/**
 * Route Generator — Phase 6
 *
 * Generates candidate swap routes from tokenIn → tokenOut.
 *
 * Strategy:
 *   1. Find all direct pools (1-hop): tokenIn/tokenOut pairs
 *   2. Find 2-hop routes via intermediate tokens:
 *      - Use tokens marked isIntermediateAllowed in the DB
 *      - For each intermediate: find pool(tokenIn, intermediate) + pool(intermediate, tokenOut)
 *   3. Probe each candidate with the full amountIn
 *   4. Rank by amountOut (descending) and prune to top K
 *
 * Pool Loading:
 *   Pools are loaded from the DB with their latest state snapshots.
 *   Only pools with fresh state (Phase 4) can be quoted.
 */

import { prisma } from "@/lib/db";
import { normalizeAddress } from "@/lib/router/address";
import { quotePool } from "@/lib/router/adapters";
import type { PoolContext } from "@/lib/router/adapters/types";
import type { PoolState } from "@/lib/router/state/types";
import type {
  CandidateRoute,
  EvaluatedRoute,
  RouteGenerationOptions,
  RouteHop,
} from "./types";

// ---------------------------------------------------------------------------
// Pool Loading
// ---------------------------------------------------------------------------

interface LoadedPool {
  poolId: string;
  address: string;
  slug: string;
  poolType: string;
  token0Addr: string;
  token1Addr: string;
  feeBps: number | null;
  tickSpacing: number | null;
  lastStateBlock: bigint | null;
  token0: { address: string; symbol: string; decimals: number };
  token1: { address: string; symbol: string; decimals: number };
  stateJson: string | null;
  stateBlock: bigint | null;
}

/**
 * Load pools that contain at least one of the given tokens,
 * along with their latest state snapshot.
 */
async function loadPools(
  tokens: string[],
  options: RouteGenerationOptions
): Promise<LoadedPool[]> {
  // Normalize to canonical lowercase for DB queries
  const normalizedTokens = tokens.map((t) => normalizeAddress(t));
  const statuses = options.poolStatuses ?? ["ACTIVE"];

  // Load pools where token0 or token1 is in our token set
  const pools = await prisma.pool.findMany({
    where: {
      status: { in: statuses },
      lastStateBlock: { not: null },
      ...(options.slugs?.length ? { slug: { in: options.slugs } } : {}),
      OR: [
        { token0Addr: { in: normalizedTokens } },
        { token1Addr: { in: normalizedTokens } },
      ],
    },
    select: {
      poolId: true,
      address: true,
      slug: true,
      poolType: true,
      token0Addr: true,
      token1Addr: true,
      feeBps: true,
      tickSpacing: true,
      lastStateBlock: true,
      tvlUsd: true,
      token0: { select: { address: true, symbol: true, decimals: true } },
      token1: { select: { address: true, symbol: true, decimals: true } },
    },
    orderBy: { tvlUsd: "desc" },
  });

  // Filter by TVL if specified
  const filtered = options.minTvlUsd
    ? pools.filter((p) => (p.tvlUsd ?? 0) >= options.minTvlUsd!)
    : pools;

  // Load latest state snapshot for each pool
  const result: LoadedPool[] = [];
  for (const pool of filtered) {
    const snapshot = await prisma.poolStateSnapshot.findFirst({
      where: { poolId: pool.poolId },
      orderBy: { blockNumber: "desc" },
      select: { stateJson: true, blockNumber: true },
    });

    result.push({
      ...pool,
      stateJson: snapshot?.stateJson ?? null,
      stateBlock: snapshot?.blockNumber ?? null,
    });
  }

  return result;
}

/**
 * Convert a LoadedPool to a PoolContext for quoting.
 */
function toPoolContext(pool: LoadedPool): PoolContext | null {
  if (!pool.stateJson) return null;

  let state: PoolState;
  try {
    state = JSON.parse(pool.stateJson) as PoolState;
  } catch {
    return null;
  }

  return {
    poolId: pool.poolId,
    address: pool.address,
    slug: pool.slug,
    poolType: pool.poolType,
    token0: pool.token0Addr,
    token1: pool.token1Addr,
    decimals0: pool.token0.decimals,
    decimals1: pool.token1.decimals,
    feeBps: pool.feeBps,
    tickSpacing: pool.tickSpacing,
    state,
    stateBlock: pool.stateBlock ?? 0n,
  };
}

// ---------------------------------------------------------------------------
// Route Generation
// ---------------------------------------------------------------------------

/**
 * Find pools that connect two specific tokens (in either direction).
 */
function findDirectPools(
  pools: LoadedPool[],
  tokenA: string,
  tokenB: string
): LoadedPool[] {
  // All addresses are canonical lowercase — direct comparison
  return pools.filter((p) => {
    return (
      (p.token0Addr === tokenA && p.token1Addr === tokenB) ||
      (p.token0Addr === tokenB && p.token1Addr === tokenA)
    );
  });
}

/**
 * Generate all candidate routes from tokenIn to tokenOut.
 */
export async function generateCandidateRoutes(
  tokenIn: string,
  tokenOut: string,
  options: RouteGenerationOptions = {}
): Promise<CandidateRoute[]> {
  const maxHops = options.maxHops ?? 2;
  const maxCandidates = options.maxCandidates ?? 20;

  // Normalize input tokens to canonical lowercase
  const normIn = normalizeAddress(tokenIn);
  const normOut = normalizeAddress(tokenOut);

  // Load intermediate tokens (already lowercase in DB)
  const intermediateTokens = await prisma.token.findMany({
    where: { isIntermediateAllowed: true },
    select: { address: true, symbol: true, decimals: true },
  });

  // Collect all tokens we need pools for
  const allRelevantTokens = new Set<string>([normIn, normOut]);
  for (const t of intermediateTokens) {
    allRelevantTokens.add(t.address);
  }

  // Load all relevant pools
  const pools = await loadPools([...allRelevantTokens], options);

  const candidates: CandidateRoute[] = [];

  // ── 1-hop: direct pools ──
  const directPools = findDirectPools(pools, normIn, normOut);
  for (const pool of directPools) {
    const ctx = toPoolContext(pool);
    if (!ctx) continue;

    const hop: RouteHop = {
      pool: ctx,
      tokenIn: normIn,
      tokenOut: normOut,
    };

    candidates.push({
      hops: [hop],
      hopCount: 1,
      intermediateToken: null,
      pathLabel: `${pool.token0.symbol}/${pool.token1.symbol} (${pool.slug})`,
    });
  }

  // ── 2-hop: via intermediate tokens ──
  if (maxHops >= 2) {
    for (const intermediate of intermediateTokens) {
      // Skip if intermediate is one of the trade tokens
      // (addresses from DB are already lowercase)
      if (
        intermediate.address === normIn ||
        intermediate.address === normOut
      ) {
        continue;
      }

      const hop1Pools = findDirectPools(pools, normIn, intermediate.address);
      const hop2Pools = findDirectPools(pools, intermediate.address, normOut);

      if (hop1Pools.length === 0 || hop2Pools.length === 0) continue;

      // Create routes for each combination (but limit to avoid explosion)
      const maxPerIntermediate = Math.max(
        1,
        Math.floor((maxCandidates - candidates.length) / intermediateTokens.length)
      );

      let count = 0;
      for (const p1 of hop1Pools) {
        for (const p2 of hop2Pools) {
          if (count >= maxPerIntermediate) break;

          const ctx1 = toPoolContext(p1);
          const ctx2 = toPoolContext(p2);
          if (!ctx1 || !ctx2) continue;

          // Don't use the same pool twice
          if (p1.poolId === p2.poolId) continue;

          const t0Sym =
            p1.token0Addr === normIn
              ? p1.token0.symbol
              : p1.token1.symbol;

          candidates.push({
            hops: [
              { pool: ctx1, tokenIn: normIn, tokenOut: intermediate.address },
              { pool: ctx2, tokenIn: intermediate.address, tokenOut: normOut },
            ],
            hopCount: 2,
            intermediateToken: intermediate.address,
            pathLabel: `${t0Sym} → ${intermediate.symbol} → ... (${p1.slug}+${p2.slug})`,
          });
          count++;
        }
        if (count >= maxPerIntermediate) break;
      }

      if (candidates.length >= maxCandidates) break;
    }
  }

  return candidates.slice(0, maxCandidates);
}

// ---------------------------------------------------------------------------
// Route Evaluation (Probe)
// ---------------------------------------------------------------------------

/**
 * Evaluate a single candidate route with the given input amount.
 * Simulates each hop sequentially, feeding output of hop N as input to hop N+1.
 */
export function evaluateRoute(
  route: CandidateRoute,
  amountIn: string
): EvaluatedRoute | null {
  let currentAmountIn = amountIn;
  const hopQuotes: EvaluatedRoute["hopQuotes"] = [];
  const allFees: EvaluatedRoute["totalFees"] = [];
  const allWarnings: string[] = [];
  let aggregateImpactBps = 0;

  for (const hop of route.hops) {
    const quote = quotePool(hop.pool, hop.tokenIn, hop.tokenOut, currentAmountIn);

    if (!quote || quote.amountOut === "0") {
      return null; // route is not viable
    }

    hopQuotes.push(quote);
    allFees.push(...quote.feePaid);
    allWarnings.push(...quote.warnings);

    // Compound price impact (approximate)
    aggregateImpactBps += quote.priceImpactBps;

    // Feed output to next hop
    currentAmountIn = quote.amountOut;
  }

  const finalAmountOut = currentAmountIn;

  // Effective price across all hops
  const lastQuote = hopQuotes[hopQuotes.length - 1];

  // Score: higher amountOut = better. Penalise high impact.
  const amountOutNum = Number(BigInt(finalAmountOut));
  const impactPenalty = Math.max(0, 1 - aggregateImpactBps / 10000);
  const score = amountOutNum * impactPenalty;

  return {
    route,
    amountOut: finalAmountOut,
    amountIn,
    hopQuotes,
    priceImpactBps: aggregateImpactBps,
    effectivePrice: lastQuote.effectivePrice,
    totalFees: allFees,
    warnings: allWarnings,
    score,
  };
}

// ---------------------------------------------------------------------------
// Public API: Generate + Evaluate + Prune
// ---------------------------------------------------------------------------

/**
 * Full route generation pipeline:
 *   1. Generate candidate routes
 *   2. Probe each with amountIn
 *   3. Rank by amountOut
 *   4. Return top K routes
 */
export async function findBestRoutes(
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  options: RouteGenerationOptions = {}
): Promise<EvaluatedRoute[]> {
  const maxRoutes = options.maxRoutes ?? 5;

  // Generate candidates (normalizeAddress is applied inside generateCandidateRoutes)
  const candidates = await generateCandidateRoutes(tokenIn, tokenOut, options);

  if (candidates.length === 0) return [];

  // Evaluate each
  const evaluated: EvaluatedRoute[] = [];
  for (const candidate of candidates) {
    const result = evaluateRoute(candidate, amountIn);
    if (result) {
      evaluated.push(result);
    }
  }

  // Sort by amountOut descending (best output first)
  evaluated.sort((a, b) => {
    const aOut = BigInt(a.amountOut);
    const bOut = BigInt(b.amountOut);
    if (bOut > aOut) return 1;
    if (bOut < aOut) return -1;
    return 0;
  });

  // Prune to top K
  return evaluated.slice(0, maxRoutes);
}
