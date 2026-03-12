/**
 * Safety & Observability — Phase 10
 *
 * Provides:
 *   1. Quote validation — sanity checks before returning a quote
 *   2. Staleness detection — warns when pool state is too old
 *   3. Metrics collection — timing, cache hit rates, error counts
 *   4. Health check endpoint data
 *
 * All checks are non-blocking (warn, don't throw). The SOR is info-only,
 * so we prefer returning a quote with warnings over refusing to quote.
 */

import { prisma } from "@/lib/db";
import { publicClient } from "@/lib/router/client";
import type { ExplainedQuote } from "@/lib/router/explain";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Warn if pool state is older than this many blocks */
const STALENESS_WARN_BLOCKS = BigInt(
  process.env.SOR_STALENESS_WARN_BLOCKS || "50"
);

/** Warn if pool state is older than this many seconds */
const STALENESS_WARN_SEC = Number(
  process.env.SOR_STALENESS_WARN_SEC || "120"
);

/** Warn if price impact exceeds this (bps) */
const HIGH_IMPACT_WARN_BPS = 500;

/** Warn if amountOut is 0 or negative */
const ZERO_OUTPUT_MSG = "Quote returned zero output — insufficient liquidity";

// ---------------------------------------------------------------------------
// In-Memory Metrics
// ---------------------------------------------------------------------------

interface SORMetrics {
  /** Total quotes served since startup */
  totalQuotes: number;
  /** Quotes that returned valid results */
  successfulQuotes: number;
  /** Quotes with no viable routes */
  emptyQuotes: number;
  /** Quotes with warnings */
  quotesWithWarnings: number;
  /** Quotes with high price impact (>5%) */
  highImpactQuotes: number;
  /** Average compute time (ms) */
  avgComputeTimeMs: number;
  /** Max compute time (ms) */
  maxComputeTimeMs: number;
  /** Total compute time (for average calculation) */
  totalComputeTimeMs: number;
  /** Pool state cache hits */
  cacheHits: number;
  /** Pool state cache misses */
  cacheMisses: number;
  /** Last quote timestamp */
  lastQuoteAt: string | null;
  /** Startup timestamp */
  startedAt: string;
}

const metrics: SORMetrics = {
  totalQuotes: 0,
  successfulQuotes: 0,
  emptyQuotes: 0,
  quotesWithWarnings: 0,
  highImpactQuotes: 0,
  avgComputeTimeMs: 0,
  maxComputeTimeMs: 0,
  totalComputeTimeMs: 0,
  cacheHits: 0,
  cacheMisses: 0,
  lastQuoteAt: null,
  startedAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Quote Validation
// ---------------------------------------------------------------------------

/**
 * Post-process a quote: add safety warnings and record metrics.
 * Mutates the quote's warnings array in place.
 */
export function validateQuote(
  quote: ExplainedQuote,
  currentBlock: bigint
): ExplainedQuote {
  const warnings = [...quote.warnings];

  // 1. Zero output check
  if (!quote.summary.amountOut || quote.summary.amountOut === "0") {
    warnings.push(ZERO_OUTPUT_MSG);
  }

  // 2. High price impact
  if (quote.summary.priceImpactBps > HIGH_IMPACT_WARN_BPS) {
    // Already warned by adapters, but add a top-level notice
    if (
      !warnings.some((w) => w.includes("High price impact"))
    ) {
      warnings.push(
        `High price impact: ${quote.summary.priceImpactPct}. ` +
          "Consider splitting into smaller trades."
      );
    }
  }

  // 3. Staleness check on as-of block
  const asOfBlock = BigInt(quote.meta.asOfBlock);
  const blockAge = currentBlock - asOfBlock;
  if (blockAge > STALENESS_WARN_BLOCKS) {
    warnings.push(
      `Pool state may be stale: read at block ${asOfBlock} ` +
        `(${blockAge} blocks behind latest ${currentBlock})`
    );
  }

  // 4. No routes warning
  if (quote.routes.length === 0 && quote.summary.amountOut !== "0") {
    warnings.push("No route trace available");
  }

  // Record metrics
  recordQuoteMetrics(quote);

  return {
    ...quote,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Metrics Recording
// ---------------------------------------------------------------------------

function recordQuoteMetrics(quote: ExplainedQuote): void {
  metrics.totalQuotes++;
  metrics.lastQuoteAt = new Date().toISOString();

  if (quote.summary.amountOut && quote.summary.amountOut !== "0") {
    metrics.successfulQuotes++;
  } else {
    metrics.emptyQuotes++;
  }

  if (quote.warnings.length > 0) {
    metrics.quotesWithWarnings++;
  }

  if (quote.summary.priceImpactBps > HIGH_IMPACT_WARN_BPS) {
    metrics.highImpactQuotes++;
  }

  const computeTime = quote.meta.computeTimeMs;
  metrics.totalComputeTimeMs += computeTime;
  metrics.avgComputeTimeMs = metrics.totalComputeTimeMs / metrics.totalQuotes;
  if (computeTime > metrics.maxComputeTimeMs) {
    metrics.maxComputeTimeMs = computeTime;
  }
}

/** Record a cache hit/miss from the state manager */
export function recordCacheHit(): void {
  metrics.cacheHits++;
}

export function recordCacheMiss(): void {
  metrics.cacheMisses++;
}

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------

export interface SORHealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  uptime: string;
  metrics: SORMetrics;
  database: {
    protocols: number;
    pools: number;
    poolsWithState: number;
    tokens: number;
    snapshots: number;
  };
  rpc: {
    connected: boolean;
    latestBlock: string;
    error?: string;
  };
  warnings: string[];
}

/**
 * Generate a health status report for the SOR.
 */
export async function getHealthStatus(): Promise<SORHealthStatus> {
  const warnings: string[] = [];
  let status: SORHealthStatus["status"] = "healthy";

  // Database stats
  const [protocols, pools, poolsWithState, tokens, snapshots] =
    await Promise.all([
      prisma.protocolRegistry.count({ where: { status: "ACTIVE" } }),
      prisma.pool.count(),
      prisma.pool.count({ where: { lastStateBlock: { not: null } } }),
      prisma.token.count(),
      prisma.poolStateSnapshot.count(),
    ]);

  if (pools === 0) {
    warnings.push("No pools discovered — run pool scan first");
    status = "degraded";
  }

  if (poolsWithState === 0 && pools > 0) {
    warnings.push("No pool states fetched — run state refresh first");
    status = "degraded";
  }

  // RPC connectivity
  let rpcConnected = false;
  let latestBlock = "0";
  let rpcError: string | undefined;
  try {
    const block = await publicClient.getBlockNumber();
    rpcConnected = true;
    latestBlock = block.toString();
  } catch (err) {
    rpcConnected = false;
    rpcError = err instanceof Error ? err.message : String(err);
    warnings.push(`RPC connection failed: ${rpcError}`);
    status = "unhealthy";
  }

  // Check staleness
  if (poolsWithState > 0) {
    const oldest = await prisma.pool.findFirst({
      where: { lastStateBlock: { not: null } },
      orderBy: { lastStateAt: "asc" },
      select: { lastStateAt: true },
    });

    if (oldest?.lastStateAt) {
      const ageMs = Date.now() - oldest.lastStateAt.getTime();
      if (ageMs > STALENESS_WARN_SEC * 1000) {
        warnings.push(
          `Oldest pool state is ${Math.round(ageMs / 1000)}s old`
        );
        if (status === "healthy") status = "degraded";
      }
    }
  }

  // Uptime
  const uptimeMs = Date.now() - new Date(metrics.startedAt).getTime();
  const uptimeSec = Math.floor(uptimeMs / 1000);
  const hours = Math.floor(uptimeSec / 3600);
  const mins = Math.floor((uptimeSec % 3600) / 60);
  const secs = uptimeSec % 60;

  return {
    status,
    version: "1.0.0",
    uptime: `${hours}h ${mins}m ${secs}s`,
    metrics: { ...metrics },
    database: {
      protocols,
      pools,
      poolsWithState,
      tokens,
      snapshots,
    },
    rpc: {
      connected: rpcConnected,
      latestBlock,
      error: rpcError,
    },
    warnings,
  };
}
