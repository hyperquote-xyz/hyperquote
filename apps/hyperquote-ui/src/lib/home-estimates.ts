/**
 * Home Page Estimate Coordinator
 *
 * Fetches live benchmark data from two server-side API routes:
 *   /api/v1/bench/hypercore/purr — Hyperliquid L2 orderbook walk (HYPE)
 *   /api/v1/bench/ht/purr        — HT.xyz EVM DEX routing (USDC → HYPE)
 *
 * All slippage is computed client-side using rfqRefOut as reference.
 * 15s client cache.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const EXAMPLE_AMOUNT_IN_DISPLAY = "100,000";
export const EXAMPLE_TOKEN_IN = "USDC";
export const EXAMPLE_TOKEN_OUT = "HYPE";

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export interface HomeComparisonData {
  /** HYPE mid-price in USD (from HyperCore orderbook) */
  spotPrice: number | null;
  /** RFQ reference: 100k / midPrice (zero-slippage ideal) */
  rfqRefOut: number | null;
  /** HyperCore market-buy walk result (HYPE received) */
  hypercoreOut: number | null;
  /** HyperCore slippage vs RFQ reference */
  hypercoreSlippagePct: number | null;
  /** HT.xyz EVM-only DEX routing (HYPE received) */
  evmOut: number | null;
  /** DEX route path label (e.g. "USDC → HYPE") */
  evmRouteLabel: string | null;
  /** Timestamp of last successful fetch */
  fetchedAt: number;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let cachedResult: HomeComparisonData | null = null;
const CACHE_TTL_MS = 15_000;

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

interface HyperCoreResponse {
  spotPrice: number | null;
  rfqRefOut: number | null;
  hypercoreOut: number | null;
  hypercoreSlippagePct: number | null;
  updatedAt: number;
  error: string | null;
}

interface HTResponse {
  evmOut: number | null;
  routeLabel: string | null;
  updatedAt: number;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Main fetcher
// ---------------------------------------------------------------------------

export async function fetchHomeComparison(): Promise<HomeComparisonData> {
  const now = Date.now();
  if (cachedResult && now - cachedResult.fetchedAt < CACHE_TTL_MS) {
    return cachedResult;
  }

  // Fetch both sources in parallel
  const [hypercoreResult, htResult] = await Promise.allSettled([
    fetchJSON<HyperCoreResponse>("/api/v1/bench/hypercore/purr"),
    fetchJSON<HTResponse>("/api/v1/bench/ht/purr"),
  ]);

  const hypercore =
    hypercoreResult.status === "fulfilled" ? hypercoreResult.value : null;
  const ht = htResult.status === "fulfilled" ? htResult.value : null;

  const result: HomeComparisonData = {
    spotPrice: hypercore?.spotPrice ?? null,
    rfqRefOut: hypercore?.rfqRefOut ?? null,
    hypercoreOut: hypercore?.hypercoreOut ?? null,
    hypercoreSlippagePct: hypercore?.hypercoreSlippagePct ?? null,
    evmOut: ht?.evmOut ?? null,
    evmRouteLabel: ht?.routeLabel ?? null,
    fetchedAt: now,
  };

  cachedResult = result;
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`${path} returned HTTP ${res.status}`);
  }
  return res.json();
}
