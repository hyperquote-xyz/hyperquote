/**
 * Pool State Module — Phase 4
 *
 * Re-exports for clean imports:
 *   import { getPoolState, batchRefreshStates } from "@/lib/router/state";
 */

export type {
  PoolState,
  V2PoolState,
  V3PoolState,
  StablePoolState,
  TickData,
  PoolStateFetchResult,
  RefreshPolicy,
} from "./types";

export {
  getPoolState,
  getPoolStates,
  getCachedState,
  batchRefreshStates,
} from "./manager";
export type { GetStateOptions, BatchRefreshResult } from "./manager";

export { fetchV2State, fetchV2StatesBatch } from "./v2-fetcher";
export { fetchV3State, fetchV3StatesBatch } from "./v3-fetcher";
