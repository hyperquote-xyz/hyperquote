/**
 * V3 Pool State Fetcher — Phase 4
 *
 * Reads on-chain state for Uniswap V3 / Concentrated Liquidity pools.
 * State includes:
 *   - slot0 (sqrtPriceX96, tick)
 *   - liquidity (current in-range)
 *   - tickSpacing
 *   - fee
 *   - tick window (initialized ticks around current price)
 *
 * Tick Window Strategy:
 *   We scan tickBitmap words around the current tick to find initialized ticks.
 *   This provides enough data for the V3 adapter to simulate swaps that cross
 *   multiple tick boundaries (Phase 5).
 *
 * The number of bitmap words to scan is configurable via TICK_BITMAP_RADIUS.
 * Each word covers 256 ticks worth of bitmap positions. At tickSpacing=60,
 * one word covers 256*60 = 15,360 tick units — roughly a ±12% price range
 * per word for common pools.
 */

import { type Address } from "viem";
import { publicClient } from "@/lib/router/client";
import { UNISWAP_V3_POOL_ABI } from "@/lib/router/abis";
import type { V3PoolState, TickData, PoolStateFetchResult } from "./types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Number of bitmap words to scan in each direction from the current tick.
 * 4 words × 256 positions × tickSpacing covers a significant price range.
 * Adjust via SOR_TICK_BITMAP_RADIUS env var for wider coverage.
 */
const TICK_BITMAP_RADIUS = Number(
  process.env.SOR_TICK_BITMAP_RADIUS || "4"
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface V3PoolInput {
  poolId: string;
  address: string;
  slug: string;
  poolType: string;
  /** Known tick spacing (from DB), avoids an extra RPC call */
  tickSpacing?: number;
  /** Known fee in hundredths of a bip (from DB feeBps * 100) */
  feeBps?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a tick to its bitmap word position.
 * wordPosition = floor(tick / tickSpacing / 256)
 */
function tickToWordPosition(tick: number, tickSpacing: number): number {
  const compressed = Math.floor(tick / tickSpacing);
  // JavaScript floor division for negative numbers
  return compressed >= 0
    ? Math.floor(compressed / 256)
    : Math.ceil((compressed + 1) / 256) - 1;
}

/**
 * Find initialized tick indices from a bitmap word.
 * Returns actual tick values (accounting for tickSpacing).
 */
function bitmapToTicks(
  wordPosition: number,
  bitmap: bigint,
  tickSpacing: number
): number[] {
  const ticks: number[] = [];
  for (let bit = 0; bit < 256; bit++) {
    if ((bitmap >> BigInt(bit)) & 1n) {
      const tickIndex = (wordPosition * 256 + bit) * tickSpacing;
      ticks.push(tickIndex);
    }
  }
  return ticks;
}

// ---------------------------------------------------------------------------
// Single Pool Fetch
// ---------------------------------------------------------------------------

/**
 * Fetch V3 state for a single pool including tick window.
 */
export async function fetchV3State(
  pool: V3PoolInput,
  blockNumber?: bigint
): Promise<PoolStateFetchResult> {
  const addr = pool.address as Address;
  const block = blockNumber ?? (await publicClient.getBlockNumber());

  try {
    // Step 1: Read slot0, liquidity, and optionally tickSpacing + fee
    const baseCallContracts: {
      address: Address;
      abi: typeof UNISWAP_V3_POOL_ABI;
      functionName: string;
    }[] = [
      { address: addr, abi: UNISWAP_V3_POOL_ABI, functionName: "slot0" },
      { address: addr, abi: UNISWAP_V3_POOL_ABI, functionName: "liquidity" },
    ];

    // Only fetch tickSpacing/fee if not already known
    if (!pool.tickSpacing) {
      baseCallContracts.push({
        address: addr,
        abi: UNISWAP_V3_POOL_ABI,
        functionName: "tickSpacing",
      });
    }
    if (pool.feeBps === undefined) {
      baseCallContracts.push({
        address: addr,
        abi: UNISWAP_V3_POOL_ABI,
        functionName: "fee",
      });
    }

    const baseResults = await publicClient.multicall({
      contracts: baseCallContracts,
      blockNumber: block,
    });

    // Parse slot0
    const slot0Result = baseResults[0];
    if (slot0Result.status !== "success") {
      throw new Error(`slot0() failed: ${slot0Result.error?.message}`);
    }
    const slot0 = slot0Result.result as [
      bigint, // sqrtPriceX96
      number, // tick
      number, // observationIndex
      number, // observationCardinality
      number, // observationCardinalityNext
      number, // feeProtocol
      boolean // unlocked
    ];
    const sqrtPriceX96 = slot0[0];
    const currentTick = Number(slot0[1]);

    // Parse liquidity
    const liquidityResult = baseResults[1];
    if (liquidityResult.status !== "success") {
      throw new Error(`liquidity() failed: ${liquidityResult.error?.message}`);
    }
    const liquidity = liquidityResult.result as bigint;

    // Parse tickSpacing
    let tickSpacing = pool.tickSpacing ?? 0;
    let fee = pool.feeBps !== undefined ? pool.feeBps * 100 : 0; // convert bps to hundredths of bip

    let resultIdx = 2;
    if (!pool.tickSpacing) {
      const tsResult = baseResults[resultIdx++];
      if (tsResult.status === "success") {
        tickSpacing = Number(tsResult.result);
      } else {
        tickSpacing = 60; // fallback
      }
    }
    if (pool.feeBps === undefined) {
      const feeResult = baseResults[resultIdx++];
      if (feeResult.status === "success") {
        fee = Number(feeResult.result);
      } else {
        fee = 3000; // fallback 0.3%
      }
    }

    if (tickSpacing <= 0) tickSpacing = 60; // safety

    // Step 2: Read tick bitmap around current tick
    const currentWordPos = tickToWordPosition(currentTick, tickSpacing);
    const bitmapWordPositions: number[] = [];
    for (
      let w = currentWordPos - TICK_BITMAP_RADIUS;
      w <= currentWordPos + TICK_BITMAP_RADIUS;
      w++
    ) {
      bitmapWordPositions.push(w);
    }

    const bitmapCalls = bitmapWordPositions.map((wp) => ({
      address: addr,
      abi: UNISWAP_V3_POOL_ABI,
      functionName: "tickBitmap" as const,
      args: [wp] as const,
    }));

    const bitmapResults = await publicClient.multicall({
      contracts: bitmapCalls,
      blockNumber: block,
    });

    // Find all initialized tick positions
    const initializedTicks: number[] = [];
    for (let i = 0; i < bitmapWordPositions.length; i++) {
      const res = bitmapResults[i];
      if (res.status === "success" && res.result !== 0n) {
        const ticks = bitmapToTicks(
          bitmapWordPositions[i],
          res.result as bigint,
          tickSpacing
        );
        initializedTicks.push(...ticks);
      }
    }

    // Step 3: Read tick data for initialized ticks
    let ticksWindow: TickData[] = [];

    if (initializedTicks.length > 0) {
      // Sort ascending
      initializedTicks.sort((a, b) => a - b);

      // Limit to reasonable count to avoid huge multicalls
      const MAX_TICKS = 100;
      const limitedTicks =
        initializedTicks.length > MAX_TICKS
          ? (() => {
              // Keep ticks closest to current tick
              const sorted = [...initializedTicks].sort(
                (a, b) => Math.abs(a - currentTick) - Math.abs(b - currentTick)
              );
              return sorted.slice(0, MAX_TICKS).sort((a, b) => a - b);
            })()
          : initializedTicks;

      const tickCalls = limitedTicks.map((tick) => ({
        address: addr,
        abi: UNISWAP_V3_POOL_ABI,
        functionName: "ticks" as const,
        args: [tick] as const,
      }));

      const tickResults = await publicClient.multicall({
        contracts: tickCalls,
        blockNumber: block,
      });

      ticksWindow = limitedTicks
        .map((tick, i) => {
          const res = tickResults[i];
          if (res.status !== "success") return null;
          const data = res.result as [
            bigint, // liquidityGross
            bigint, // liquidityNet
            bigint, // feeGrowthOutside0X128
            bigint, // feeGrowthOutside1X128
            bigint, // tickCumulativeOutside
            bigint, // secondsPerLiquidityOutsideX128
            number, // secondsOutside
            boolean // initialized
          ];
          return {
            tick,
            liquidityGross: data[0].toString(),
            liquidityNet: data[1].toString(),
          } satisfies TickData;
        })
        .filter((t): t is TickData => t !== null);
    }

    const state: V3PoolState = {
      type: "V3",
      sqrtPriceX96: sqrtPriceX96.toString(),
      liquidity: liquidity.toString(),
      tick: currentTick,
      tickSpacing,
      fee,
      ticksWindow,
    };

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
// Batch Fetch
// ---------------------------------------------------------------------------

/**
 * Fetch V3 state for multiple pools.
 * V3 state is complex (slot0 + liquidity + tick bitmap + ticks), so
 * we process pools sequentially to avoid overwhelming the RPC.
 * Each individual pool uses multicall internally for its sub-calls.
 */
export async function fetchV3StatesBatch(
  pools: V3PoolInput[],
  blockNumber?: bigint
): Promise<PoolStateFetchResult[]> {
  if (pools.length === 0) return [];

  const block = blockNumber ?? (await publicClient.getBlockNumber());
  const results: PoolStateFetchResult[] = [];

  for (const pool of pools) {
    results.push(await fetchV3State(pool, block));
  }

  return results;
}
