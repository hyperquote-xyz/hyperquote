/**
 * Pool State Types — Phase 4
 *
 * Type-safe state representations for each pool type.
 * These structures are what gets stored in pool_state_snapshots.state_json
 * and used by the adapter library (Phase 5) for quote simulation.
 */

// ---------------------------------------------------------------------------
// V2 State (Uniswap V2 / Velodrome / Solidly forks)
// ---------------------------------------------------------------------------

export interface V2PoolState {
  type: "V2";
  /** Reserve of token0 (raw BigInt string) */
  reserve0: string;
  /** Reserve of token1 (raw BigInt string) */
  reserve1: string;
  /** Whether this is a Velodrome-style stable pool */
  isStable?: boolean;
}

// ---------------------------------------------------------------------------
// V3 State (Uniswap V3 / Concentrated Liquidity)
// ---------------------------------------------------------------------------

export interface TickData {
  /** Tick index */
  tick: number;
  /** Net liquidity delta when crossing this tick left→right */
  liquidityNet: string;
  /** Gross liquidity referenced at this tick */
  liquidityGross: string;
}

export interface V3PoolState {
  type: "V3";
  /** Current sqrt price as Q64.96 (BigInt string) */
  sqrtPriceX96: string;
  /** Current in-range liquidity (BigInt string) */
  liquidity: string;
  /** Current tick */
  tick: number;
  /** Tick spacing for this pool */
  tickSpacing: number;
  /** Fee in hundredths of a bip (e.g. 3000 = 0.3%) */
  fee: number;
  /**
   * Populated tick window around the current tick.
   * Sorted ascending by tick index.
   * Used for tick-traversal simulation in the V3 adapter.
   */
  ticksWindow: TickData[];
}

// ---------------------------------------------------------------------------
// Stable State (StableSwap / Curve-style)
// ---------------------------------------------------------------------------

export interface StablePoolState {
  type: "STABLE";
  /** Token balances (raw BigInt strings), same order as pool tokens */
  balances: string[];
  /** Amplification coefficient (BigInt string) */
  amp: string;
  /** Fee as basis points */
  feeBps: number;
}

// ---------------------------------------------------------------------------
// Union Type
// ---------------------------------------------------------------------------

export type PoolState = V2PoolState | V3PoolState | StablePoolState;

// ---------------------------------------------------------------------------
// Fetch Result — wraps state with metadata
// ---------------------------------------------------------------------------

export interface PoolStateFetchResult {
  poolId: string;
  poolAddress: string;
  poolType: string;
  slug: string;
  /** The block at which this state was read */
  blockNumber: bigint;
  /** Timestamp of the state read */
  timestamp: Date;
  /** The parsed state, null if fetch failed */
  state: PoolState | null;
  /** Error message if fetch failed */
  error?: string;
}

// ---------------------------------------------------------------------------
// Refresh Policy
// ---------------------------------------------------------------------------

export interface RefreshPolicy {
  /** Maximum age in seconds before state is considered stale */
  maxAgeSec: number;
  /** Maximum age in blocks before state is considered stale */
  maxAgeBlocks: number;
}
