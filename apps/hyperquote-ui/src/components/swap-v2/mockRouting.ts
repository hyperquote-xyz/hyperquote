import { Token } from "@/types";
import { safeSymbol } from "@/lib/utils";

export interface MockDexRoute {
  /** Ordered token symbols in the path, e.g. ["HYPE", "USDC"] or ["HYPE", "USDC", "KNTQ"] */
  route: string[];
  amountOut: number;
  slippageBps: number;
  isDirect: boolean;
  reason: "direct" | "fallback_via_usdc" | "no_route";
}

/**
 * Pairs that have a mock direct pool with reasonable liquidity.
 * Key format: sorted `SYMBOL_A/SYMBOL_B`.
 */
const DIRECT_POOLS = new Set([
  "HYPE/USDC",
  "HYPE/WHYPE",
  "PURR/USDC",
  "USDC/USDT",
]);

/** Mock max direct-pool size in USD before slippage exceeds 10% */
const DIRECT_POOL_MAX_USD = 500_000;

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("/");
}

/**
 * Simulates DEX route selection for the swap-v2 mockup.
 *
 * Logic:
 * 1. If a direct pool exists between tokenIn and tokenOut,
 *    check whether the trade size causes >10% slippage.
 *    - If slippage <= 10%, use direct route.
 * 2. Otherwise, route through USDC: tokenIn → USDC → tokenOut.
 * 3. If neither works, return no_route.
 */
export function getMockDexRoute(
  tokenIn: Token | null,
  tokenOut: Token | null,
  amountUsd: number
): MockDexRoute {
  if (!tokenIn || !tokenOut) {
    return { route: [], amountOut: 0, slippageBps: 0, isDirect: false, reason: "no_route" };
  }

  const symIn = safeSymbol(tokenIn);
  const symOut = safeSymbol(tokenOut);
  const key = pairKey(symIn, symOut);

  // Check for direct pool
  if (DIRECT_POOLS.has(key)) {
    const slippageBps = Math.round((amountUsd / DIRECT_POOL_MAX_USD) * 1000);
    if (slippageBps <= 1000) {
      // Direct pool viable
      return {
        route: [symIn, symOut],
        amountOut: amountUsd * (1 - slippageBps / 10000),
        slippageBps,
        isDirect: true,
        reason: "direct",
      };
    }
    // Direct pool exists but too much slippage — fall through to USDC routing
  }

  // Check if either token IS USDC (no double-hop needed)
  if (symIn === "USDC" || symOut === "USDC") {
    const slippageBps = Math.round((amountUsd / DIRECT_POOL_MAX_USD) * 600);
    return {
      route: [symIn, symOut],
      amountOut: amountUsd * (1 - slippageBps / 10000),
      slippageBps,
      isDirect: true,
      reason: "direct",
    };
  }

  // Fallback: route through USDC
  const hasInToUsdc = DIRECT_POOLS.has(pairKey(symIn, "USDC")) || true; // mock: always assume leg exists
  const hasUsdcToOut = DIRECT_POOLS.has(pairKey("USDC", symOut)) || true;

  if (hasInToUsdc && hasUsdcToOut) {
    const slippageBps = Math.round((amountUsd / DIRECT_POOL_MAX_USD) * 800) + 15; // extra hop cost
    return {
      route: [symIn, "USDC", symOut],
      amountOut: amountUsd * (1 - slippageBps / 10000),
      slippageBps,
      isDirect: false,
      reason: "fallback_via_usdc",
    };
  }

  return { route: [], amountOut: 0, slippageBps: 0, isDirect: false, reason: "no_route" };
}
