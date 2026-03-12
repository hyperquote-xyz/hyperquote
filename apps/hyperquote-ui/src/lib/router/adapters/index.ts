/**
 * Adapter Registry — Phase 5 (Audit Fix #3)
 *
 * Maps pool types to their adapter implementations.
 * The route engine uses getAdapter() to find the right quoting logic.
 *
 * IMPORTANT: The Solidly stable adapter (x³y + xy³ = k) is ONLY used
 * for confirmed Velodrome/Solidly forks. Other protocols with isStable=true
 * fall through to V2 constant-product with a warning.
 *
 * Usage:
 *   import { getAdapter, quotePool } from "@/lib/router/adapters";
 *   const quote = quotePool(poolContext, tokenIn, tokenOut, amountIn);
 */

import type { PoolAdapter, QuoteResult, PoolContext } from "./types";
import { v2Adapter } from "./v2";
import { v3Adapter } from "./v3";
import { stableAdapter } from "./stable";

// Re-exports
export type { PoolAdapter, QuoteResult, PoolContext } from "./types";

// ---------------------------------------------------------------------------
// Confirmed Solidly/Velodrome forks
// ---------------------------------------------------------------------------
// Only these protocol slugs use the Solidly invariant (x³y + xy³ = k).
// All others with isStable=true get V2 constant-product + warning.

const SOLIDLY_PROTOCOL_SLUGS = new Set<string>([
  "kittenswap-amm",
  // Add new confirmed Solidly forks here as they launch on HyperEVM
]);

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const ADAPTERS: PoolAdapter[] = [v2Adapter, v3Adapter, stableAdapter];

/**
 * Find the adapter for a given pool type.
 */
export function getAdapter(poolType: string): PoolAdapter | null {
  return (
    ADAPTERS.find((a) => a.supportedTypes.includes(poolType)) ?? null
  );
}

// ---------------------------------------------------------------------------
// Convenience: Quote a single pool
// ---------------------------------------------------------------------------

/**
 * Quote a single pool using the appropriate adapter.
 * This is the main entry point for the route engine.
 *
 * Stable adapter selection logic:
 *   - isStable=true + confirmed Solidly fork → STABLE adapter (x³y + xy³ = k)
 *   - isStable=true + unknown protocol → V2 adapter + warning
 *   - All other pools → adapter matched by poolType
 */
export function quotePool(
  pool: PoolContext,
  tokenIn: string,
  tokenOut: string,
  amountIn: string
): QuoteResult | null {
  let effectivePoolType = pool.poolType;
  let extraWarning: string | null = null;

  // Handle stable pool routing
  if (
    pool.poolType === "V2" &&
    pool.state.type === "V2" &&
    pool.state.isStable
  ) {
    if (SOLIDLY_PROTOCOL_SLUGS.has(pool.slug)) {
      // Confirmed Solidly fork → use Solidly stable invariant
      effectivePoolType = "STABLE";
    } else {
      // Unknown protocol with isStable=true → stay on V2 constant-product
      // Add warning so the user knows the quote may be inaccurate
      effectivePoolType = "V2";
      extraWarning =
        `Pool ${pool.address} (${pool.slug}) has isStable=true but is not a confirmed ` +
        `Solidly fork. Using V2 constant-product — quote may be inaccurate for stable pairs.`;
    }
  }

  const adapter = getAdapter(effectivePoolType);
  if (!adapter) return null;

  const result = adapter.quoteExactIn(
    pool.state,
    tokenIn,
    tokenOut,
    amountIn,
    pool.token0,
    pool.token1,
    pool.decimals0,
    pool.decimals1
  );

  // Append warning if needed
  if (result && extraWarning) {
    result.warnings.push(extraWarning);
  }

  return result;
}
