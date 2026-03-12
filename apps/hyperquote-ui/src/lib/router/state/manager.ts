/**
 * Pool State Manager — Phase 4
 *
 * Orchestrates pool state fetching, caching, and persistence.
 *
 * Responsibilities:
 *   1. Load pools from DB that need state refresh
 *   2. Dispatch to V2/V3 fetchers based on pool type
 *   3. Persist snapshots to pool_state_snapshots
 *   4. Update pool.last_state_block / last_state_at
 *   5. Mark pools EMPTY/BROKEN based on state
 *   6. Provide getState() for the adapter layer with staleness checks
 *
 * Refresh Strategy:
 *   - "on-demand": caller requests state for specific pools, fetch if stale
 *   - "batch": periodic background refresh of all active pools
 */

import { prisma } from "@/lib/db";
import { publicClient } from "@/lib/router/client";
import { fetchV2State, fetchV2StatesBatch } from "./v2-fetcher";
import { fetchV3State, fetchV3StatesBatch } from "./v3-fetcher";
import type {
  PoolState,
  PoolStateFetchResult,
  RefreshPolicy,
  V2PoolState,
} from "./types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Default refresh policy */
const DEFAULT_POLICY: RefreshPolicy = {
  maxAgeSec: Number(process.env.SOR_STATE_MAX_AGE_SEC || "60"),
  maxAgeBlocks: Number(process.env.SOR_STATE_MAX_AGE_BLOCKS || "30"),
};

/** Max pools per batch refresh cycle */
const BATCH_SIZE = Number(process.env.SOR_STATE_BATCH_SIZE || "50");

// ---------------------------------------------------------------------------
// Staleness Check
// ---------------------------------------------------------------------------

/**
 * Determine if a pool's state is stale and needs refresh.
 */
function isStale(
  lastStateBlock: bigint | null,
  lastStateAt: Date | null,
  currentBlock: bigint,
  policy: RefreshPolicy
): boolean {
  if (!lastStateBlock || !lastStateAt) return true;

  const blockAge = currentBlock - lastStateBlock;
  if (blockAge > BigInt(policy.maxAgeBlocks)) return true;

  const ageMs = Date.now() - lastStateAt.getTime();
  if (ageMs > policy.maxAgeSec * 1000) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Pool Type Classification
// ---------------------------------------------------------------------------

/** Protocols known to use Velodrome/Solidly-style pools */
const VELODROME_SLUGS = new Set(["kittenswap-amm"]);

function isV2Type(poolType: string): boolean {
  return poolType === "V2" || poolType === "STABLE";
}

function isV3Type(poolType: string): boolean {
  return poolType === "V3";
}

// ---------------------------------------------------------------------------
// State Persistence
// ---------------------------------------------------------------------------

/**
 * Save a state fetch result to the DB.
 * Creates a snapshot and updates the pool's lastStateBlock/lastStateAt.
 */
async function persistState(result: PoolStateFetchResult): Promise<void> {
  if (!result.state) return;

  await prisma.$transaction([
    // Upsert snapshot (idempotent on poolId+blockNumber)
    prisma.poolStateSnapshot.upsert({
      where: {
        poolId_blockNumber: {
          poolId: result.poolId,
          blockNumber: result.blockNumber,
        },
      },
      create: {
        poolId: result.poolId,
        blockNumber: result.blockNumber,
        timestamp: result.timestamp,
        stateJson: JSON.stringify(result.state),
      },
      update: {
        stateJson: JSON.stringify(result.state),
        timestamp: result.timestamp,
      },
    }),
    // Update pool tracking fields
    prisma.pool.update({
      where: { poolId: result.poolId },
      data: {
        lastStateBlock: result.blockNumber,
        lastStateAt: result.timestamp,
        // Auto-detect empty pools (V2 with zero reserves)
        ...(result.state.type === "V2" &&
        result.state.reserve0 === "0" &&
        result.state.reserve1 === "0"
          ? { status: "EMPTY" }
          : result.state.type === "V3" && result.state.liquidity === "0"
            ? { status: "EMPTY" }
            : { status: "ACTIVE" }),
      },
    }),
  ]);
}

/**
 * Mark a pool as BROKEN (state fetch failed).
 */
async function markBroken(poolId: string, error: string): Promise<void> {
  await prisma.pool.update({
    where: { poolId },
    data: { status: "BROKEN" },
  });
  console.warn(`[state-manager] Pool ${poolId} marked BROKEN: ${error}`);
}

// ---------------------------------------------------------------------------
// Public API: Get State (on-demand with staleness)
// ---------------------------------------------------------------------------

export interface GetStateOptions {
  /** Override refresh policy */
  policy?: RefreshPolicy;
  /** Force refresh even if not stale */
  forceRefresh?: boolean;
  /** Specific block to fetch state at (default: latest) */
  blockNumber?: bigint;
}

/**
 * Get the current state for a single pool.
 * Returns cached state if fresh, fetches on-demand if stale.
 */
export async function getPoolState(
  poolId: string,
  options?: GetStateOptions
): Promise<PoolStateFetchResult | null> {
  const policy = options?.policy ?? DEFAULT_POLICY;

  const pool = await prisma.pool.findUnique({
    where: { poolId },
    select: {
      poolId: true,
      address: true,
      poolType: true,
      slug: true,
      feeBps: true,
      tickSpacing: true,
      lastStateBlock: true,
      lastStateAt: true,
      status: true,
    },
  });

  if (!pool) return null;

  const currentBlock =
    options?.blockNumber ?? (await publicClient.getBlockNumber());

  // Check if we can use cached state
  if (
    !options?.forceRefresh &&
    !isStale(pool.lastStateBlock, pool.lastStateAt, currentBlock, policy)
  ) {
    // Load latest snapshot from DB
    const snapshot = await prisma.poolStateSnapshot.findFirst({
      where: { poolId },
      orderBy: { blockNumber: "desc" },
    });

    if (snapshot) {
      return {
        poolId: pool.poolId,
        poolAddress: pool.address,
        poolType: pool.poolType,
        slug: pool.slug,
        blockNumber: snapshot.blockNumber,
        timestamp: snapshot.timestamp,
        state: JSON.parse(snapshot.stateJson) as PoolState,
      };
    }
  }

  // Fetch fresh state
  const result = await fetchSinglePool(pool, currentBlock);

  // Persist
  if (result.state) {
    await persistState(result);
  } else if (result.error) {
    await markBroken(pool.poolId, result.error);
  }

  return result;
}

/**
 * Get states for multiple pools at once.
 * Batches RPC calls by pool type.
 */
export async function getPoolStates(
  poolIds: string[],
  options?: GetStateOptions
): Promise<PoolStateFetchResult[]> {
  if (poolIds.length === 0) return [];

  const policy = options?.policy ?? DEFAULT_POLICY;
  const currentBlock =
    options?.blockNumber ?? (await publicClient.getBlockNumber());

  const pools = await prisma.pool.findMany({
    where: { poolId: { in: poolIds } },
    select: {
      poolId: true,
      address: true,
      poolType: true,
      slug: true,
      feeBps: true,
      tickSpacing: true,
      lastStateBlock: true,
      lastStateAt: true,
      status: true,
    },
  });

  const results: PoolStateFetchResult[] = [];
  const needsFetch: typeof pools = [];

  // Check cache for each pool
  for (const pool of pools) {
    if (
      !options?.forceRefresh &&
      !isStale(pool.lastStateBlock, pool.lastStateAt, currentBlock, policy)
    ) {
      const snapshot = await prisma.poolStateSnapshot.findFirst({
        where: { poolId: pool.poolId },
        orderBy: { blockNumber: "desc" },
      });

      if (snapshot) {
        results.push({
          poolId: pool.poolId,
          poolAddress: pool.address,
          poolType: pool.poolType,
          slug: pool.slug,
          blockNumber: snapshot.blockNumber,
          timestamp: snapshot.timestamp,
          state: JSON.parse(snapshot.stateJson) as PoolState,
        });
        continue;
      }
    }
    needsFetch.push(pool);
  }

  if (needsFetch.length === 0) return results;

  // Group by pool type for batched fetching
  const v2Pools = needsFetch.filter((p) => isV2Type(p.poolType));
  const v3Pools = needsFetch.filter((p) => isV3Type(p.poolType));

  // Fetch V2 pools (multicall)
  if (v2Pools.length > 0) {
    const v2Results = await fetchV2StatesBatch(
      v2Pools.map((p) => ({
        poolId: p.poolId,
        address: p.address,
        slug: p.slug,
        poolType: p.poolType,
        isVelodrome: VELODROME_SLUGS.has(p.slug),
      })),
      currentBlock
    );

    for (const r of v2Results) {
      if (r.state) {
        await persistState(r);
      } else if (r.error) {
        await markBroken(r.poolId, r.error);
      }
      results.push(r);
    }
  }

  // Fetch V3 pools (sequential multicalls per pool)
  if (v3Pools.length > 0) {
    const v3Results = await fetchV3StatesBatch(
      v3Pools.map((p) => ({
        poolId: p.poolId,
        address: p.address,
        slug: p.slug,
        poolType: p.poolType,
        tickSpacing: p.tickSpacing ?? undefined,
        feeBps: p.feeBps ?? undefined,
      })),
      currentBlock
    );

    for (const r of v3Results) {
      if (r.state) {
        await persistState(r);
      } else if (r.error) {
        await markBroken(r.poolId, r.error);
      }
      results.push(r);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Public API: Batch Refresh
// ---------------------------------------------------------------------------

export interface BatchRefreshResult {
  timestamp: string;
  blockNumber: bigint;
  totalPools: number;
  refreshed: number;
  skippedFresh: number;
  errors: number;
  empty: number;
  details: {
    poolId: string;
    address: string;
    poolType: string;
    slug: string;
    status: "ok" | "empty" | "error";
    error?: string;
  }[];
}

/**
 * Refresh state for all pools that are stale.
 * Processes in batches to avoid RPC overload.
 */
export async function batchRefreshStates(options?: {
  /** Override policy */
  policy?: RefreshPolicy;
  /** Only refresh pools for these protocols */
  slugs?: string[];
  /** Only refresh pools matching these addresses */
  poolAddresses?: string[];
  /** Force refresh all, ignoring staleness */
  forceRefresh?: boolean;
  /** Max pools to refresh (default: BATCH_SIZE) */
  limit?: number;
}): Promise<BatchRefreshResult> {
  const policy = options?.policy ?? DEFAULT_POLICY;
  const limit = options?.limit ?? BATCH_SIZE;
  const currentBlock = await publicClient.getBlockNumber();

  // Build query
  const where: Record<string, unknown> = {
    status: { not: "BROKEN" },
  };
  if (options?.slugs?.length) {
    where.slug = { in: options.slugs };
  }
  if (options?.poolAddresses?.length) {
    where.address = { in: options.poolAddresses };
  }

  const pools = await prisma.pool.findMany({
    where,
    select: {
      poolId: true,
      address: true,
      poolType: true,
      slug: true,
      feeBps: true,
      tickSpacing: true,
      lastStateBlock: true,
      lastStateAt: true,
    },
    take: limit * 2, // over-fetch to account for fresh pools
    orderBy: [
      { lastStateAt: "asc" }, // oldest state first
    ],
  });

  const result: BatchRefreshResult = {
    timestamp: new Date().toISOString(),
    blockNumber: currentBlock,
    totalPools: pools.length,
    refreshed: 0,
    skippedFresh: 0,
    errors: 0,
    empty: 0,
    details: [],
  };

  // Filter to stale pools
  const stalePools = options?.forceRefresh
    ? pools
    : pools.filter((p) =>
        isStale(p.lastStateBlock, p.lastStateAt, currentBlock, policy)
      );

  result.skippedFresh = pools.length - stalePools.length;

  // Limit
  const toRefresh = stalePools.slice(0, limit);

  console.log(
    `[state-manager] Refreshing ${toRefresh.length} of ${pools.length} pools ` +
      `(${result.skippedFresh} fresh, block ${currentBlock})`
  );

  // Group and fetch
  const v2Pools = toRefresh.filter((p) => isV2Type(p.poolType));
  const v3Pools = toRefresh.filter((p) => isV3Type(p.poolType));

  // V2 batch
  if (v2Pools.length > 0) {
    const v2Results = await fetchV2StatesBatch(
      v2Pools.map((p) => ({
        poolId: p.poolId,
        address: p.address,
        slug: p.slug,
        poolType: p.poolType,
        isVelodrome: VELODROME_SLUGS.has(p.slug),
      })),
      currentBlock
    );

    for (const r of v2Results) {
      if (r.state) {
        await persistState(r);
        const isEmpty =
          r.state.type === "V2" &&
          r.state.reserve0 === "0" &&
          r.state.reserve1 === "0";
        result.refreshed++;
        if (isEmpty) result.empty++;
        result.details.push({
          poolId: r.poolId,
          address: r.poolAddress,
          poolType: r.poolType,
          slug: r.slug,
          status: isEmpty ? "empty" : "ok",
        });
      } else {
        await markBroken(r.poolId, r.error ?? "unknown error");
        result.errors++;
        result.details.push({
          poolId: r.poolId,
          address: r.poolAddress,
          poolType: r.poolType,
          slug: r.slug,
          status: "error",
          error: r.error,
        });
      }
    }
  }

  // V3 sequential
  if (v3Pools.length > 0) {
    const v3Results = await fetchV3StatesBatch(
      v3Pools.map((p) => ({
        poolId: p.poolId,
        address: p.address,
        slug: p.slug,
        poolType: p.poolType,
        tickSpacing: p.tickSpacing ?? undefined,
        feeBps: p.feeBps ?? undefined,
      })),
      currentBlock
    );

    for (const r of v3Results) {
      if (r.state) {
        await persistState(r);
        const isEmpty = r.state.type === "V3" && r.state.liquidity === "0";
        result.refreshed++;
        if (isEmpty) result.empty++;
        result.details.push({
          poolId: r.poolId,
          address: r.poolAddress,
          poolType: r.poolType,
          slug: r.slug,
          status: isEmpty ? "empty" : "ok",
        });
      } else {
        await markBroken(r.poolId, r.error ?? "unknown error");
        result.errors++;
        result.details.push({
          poolId: r.poolId,
          address: r.poolAddress,
          poolType: r.poolType,
          slug: r.slug,
          status: "error",
          error: r.error,
        });
      }
    }
  }

  console.log(
    `[state-manager] Refresh complete: ${result.refreshed} ok, ` +
      `${result.empty} empty, ${result.errors} errors`
  );

  return result;
}

// ---------------------------------------------------------------------------
// Internal: Fetch dispatcher
// ---------------------------------------------------------------------------

async function fetchSinglePool(
  pool: {
    poolId: string;
    address: string;
    poolType: string;
    slug: string;
    feeBps: number | null;
    tickSpacing: number | null;
  },
  blockNumber: bigint
): Promise<PoolStateFetchResult> {
  if (isV2Type(pool.poolType)) {
    return fetchV2State(
      {
        poolId: pool.poolId,
        address: pool.address,
        slug: pool.slug,
        poolType: pool.poolType,
        isVelodrome: VELODROME_SLUGS.has(pool.slug),
      },
      blockNumber
    );
  }

  if (isV3Type(pool.poolType)) {
    return fetchV3State(
      {
        poolId: pool.poolId,
        address: pool.address,
        slug: pool.slug,
        poolType: pool.poolType,
        tickSpacing: pool.tickSpacing ?? undefined,
        feeBps: pool.feeBps ?? undefined,
      },
      blockNumber
    );
  }

  // Unknown pool type
  return {
    poolId: pool.poolId,
    poolAddress: pool.address,
    poolType: pool.poolType,
    slug: pool.slug,
    blockNumber,
    timestamp: new Date(),
    state: null,
    error: `Unsupported pool type: ${pool.poolType}`,
  };
}

// ---------------------------------------------------------------------------
// Public API: Get Latest Cached State (no fetch)
// ---------------------------------------------------------------------------

/**
 * Get the latest cached state from DB without triggering any RPC calls.
 * Returns null if no snapshot exists.
 */
export async function getCachedState(
  poolId: string
): Promise<{ state: PoolState; blockNumber: bigint; timestamp: Date } | null> {
  const snapshot = await prisma.poolStateSnapshot.findFirst({
    where: { poolId },
    orderBy: { blockNumber: "desc" },
  });

  if (!snapshot) return null;

  return {
    state: JSON.parse(snapshot.stateJson) as PoolState,
    blockNumber: snapshot.blockNumber,
    timestamp: snapshot.timestamp,
  };
}
