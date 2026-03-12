/**
 * V2 Pool State Fetcher — Phase 4
 *
 * Reads on-chain state for Uniswap V2 / Velodrome / Solidly-style pools.
 * Uses multicall to batch getReserves() calls for efficiency.
 *
 * State shape: { reserve0, reserve1, isStable? }
 */

import { type Address } from "viem";
import { publicClient } from "@/lib/router/client";
import { UNISWAP_V2_PAIR_ABI, VELODROME_PAIR_ABI } from "@/lib/router/abis";
import type { V2PoolState, PoolStateFetchResult } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface V2PoolInput {
  poolId: string;
  address: string;
  slug: string;
  poolType: string;
  /** If true, also read the stable() flag (Velodrome/Solidly forks) */
  isVelodrome?: boolean;
}

// ---------------------------------------------------------------------------
// Single Pool Fetch
// ---------------------------------------------------------------------------

/**
 * Fetch V2 reserves for a single pool.
 */
export async function fetchV2State(
  pool: V2PoolInput,
  blockNumber?: bigint
): Promise<PoolStateFetchResult> {
  const addr = pool.address as Address;
  const block = blockNumber ?? (await publicClient.getBlockNumber());

  try {
    const reserves = await publicClient.readContract({
      address: addr,
      abi: UNISWAP_V2_PAIR_ABI,
      functionName: "getReserves",
      blockNumber: block,
    });

    const [reserve0, reserve1] = reserves as [bigint, bigint, number];

    const state: V2PoolState = {
      type: "V2",
      reserve0: reserve0.toString(),
      reserve1: reserve1.toString(),
    };

    // For Velodrome forks, check if it's a stable pool
    if (pool.isVelodrome) {
      try {
        const isStable = await publicClient.readContract({
          address: addr,
          abi: VELODROME_PAIR_ABI,
          functionName: "stable",
          blockNumber: block,
        });
        state.isStable = isStable as boolean;
      } catch {
        // stable() might not exist, that's OK
      }
    }

    return {
      poolId: pool.poolId,
      poolAddress: pool.address,
      poolType: pool.poolType,
      slug: pool.slug,
      blockNumber: block,
      timestamp: new Date(),
      state,
    };
  } catch (err) {
    return {
      poolId: pool.poolId,
      poolAddress: pool.address,
      poolType: pool.poolType,
      slug: pool.slug,
      blockNumber: block,
      timestamp: new Date(),
      state: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Batch Fetch (multicall)
// ---------------------------------------------------------------------------

/**
 * Fetch V2 reserves for multiple pools using multicall.
 * Falls back to individual calls if multicall fails.
 */
export async function fetchV2StatesBatch(
  pools: V2PoolInput[],
  blockNumber?: bigint
): Promise<PoolStateFetchResult[]> {
  if (pools.length === 0) return [];

  const block = blockNumber ?? (await publicClient.getBlockNumber());

  try {
    // Build multicall contracts array
    const calls = pools.map((pool) => ({
      address: pool.address as Address,
      abi: UNISWAP_V2_PAIR_ABI,
      functionName: "getReserves" as const,
    }));

    const results = await publicClient.multicall({
      contracts: calls,
      blockNumber: block,
    });

    const fetchResults: PoolStateFetchResult[] = [];

    for (let i = 0; i < pools.length; i++) {
      const pool = pools[i];
      const result = results[i];

      if (result.status === "success") {
        const [reserve0, reserve1] = result.result as [bigint, bigint, number];
        const state: V2PoolState = {
          type: "V2",
          reserve0: reserve0.toString(),
          reserve1: reserve1.toString(),
        };

        fetchResults.push({
          poolId: pool.poolId,
          poolAddress: pool.address,
          poolType: pool.poolType,
          slug: pool.slug,
          blockNumber: block,
          timestamp: new Date(),
          state,
        });
      } else {
        fetchResults.push({
          poolId: pool.poolId,
          poolAddress: pool.address,
          poolType: pool.poolType,
          slug: pool.slug,
          blockNumber: block,
          timestamp: new Date(),
          state: null,
          error: result.error?.message ?? "multicall failed",
        });
      }
    }

    return fetchResults;
  } catch (err) {
    // Multicall failed entirely — fall back to individual calls
    console.warn(
      `[v2-fetcher] Multicall failed for ${pools.length} pools, falling back to individual calls:`,
      err instanceof Error ? err.message : err
    );

    const results: PoolStateFetchResult[] = [];
    for (const pool of pools) {
      results.push(await fetchV2State(pool, block));
    }
    return results;
  }
}
