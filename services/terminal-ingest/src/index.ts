/**
 * Terminal Ingest — Main Entrypoint
 *
 * Starts all ingestion workers:
 *   1. Derive Poller   — option tickers + trades from Derive (Lyra v2)
 *   2. Chain Indexer    — on-chain events from OptionsEngine + SettlementPublisher
 *   3. HL Context       — Hyperliquid spot/perp reference prices
 *   4. Retention        — daily cleanup of hl_spot (7d) and derive_trades (30d)
 *
 * unified_tape is a real table — workers insert directly on each trade.
 * No periodic REFRESH needed.
 *
 * Usage:
 *   npm run dev       — starts with tsx watch
 *   npm start         — starts compiled JS
 */

import "dotenv/config";
import { shutdown, healthCheck, query } from "./db.js";
import { startDerivePoller, stopDerivePoller } from "./derive-poller.js";
import { startChainIndexer, stopChainIndexer } from "./chain-indexer.js";
import { startHlPoller, stopHlPoller } from "./hl-context.js";

// ---------------------------------------------------------------------------
// Retention policy
// ---------------------------------------------------------------------------
// Runs once daily. Deletes old rows from high-volume tables only.
// Does NOT touch unified_tape, hq_executions, or hq_settlements.

const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const HL_SPOT_RETENTION_DAYS = Number(process.env.HL_SPOT_RETENTION_DAYS || "7");
const DERIVE_TRADES_RETENTION_DAYS = Number(process.env.DERIVE_TRADES_RETENTION_DAYS || "30");

let retentionTimer: ReturnType<typeof setInterval> | null = null;

async function runRetention(): Promise<void> {
  try {
    // hl_spot: keep 7 days
    const hlResult = await query(
      `DELETE FROM hl_spot WHERE sampled_at < NOW() - INTERVAL '1 day' * $1`,
      [HL_SPOT_RETENTION_DAYS],
    );
    const hlDeleted = hlResult.rowCount ?? 0;

    // derive_trades: keep 30 days
    const dtResult = await query(
      `DELETE FROM derive_trades WHERE traded_at < NOW() - INTERVAL '1 day' * $1`,
      [DERIVE_TRADES_RETENTION_DAYS],
    );
    const dtDeleted = dtResult.rowCount ?? 0;

    if (hlDeleted > 0 || dtDeleted > 0) {
      console.log(
        `[retention] Cleaned up: hl_spot=${hlDeleted} rows (>${HL_SPOT_RETENTION_DAYS}d), ` +
        `derive_trades=${dtDeleted} rows (>${DERIVE_TRADES_RETENTION_DAYS}d)`,
      );
    } else {
      console.log("[retention] No rows to clean up.");
    }
  } catch (err) {
    console.error("[retention] Cleanup error:", (err as Error).message);
  }
}

function startRetention(): void {
  console.log(
    `[retention] Scheduled daily cleanup: hl_spot=${HL_SPOT_RETENTION_DAYS}d, ` +
    `derive_trades=${DERIVE_TRADES_RETENTION_DAYS}d`,
  );
  // Run once at startup, then every 24h
  void runRetention();
  retentionTimer = setInterval(() => void runRetention(), RETENTION_INTERVAL_MS);
}

function stopRetention(): void {
  if (retentionTimer) {
    clearInterval(retentionTimer);
    retentionTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("  HyperQuote Options Terminal — Ingestion Service");
  console.log("=".repeat(60));

  // Verify database connectivity
  const healthy = await healthCheck();
  if (!healthy) {
    console.error("[main] Cannot connect to database. Check DATABASE_URL.");
    process.exit(1);
  }
  console.log("[main] Database connected.");

  // Start workers
  startDerivePoller();
  startChainIndexer();
  startHlPoller();
  startRetention();

  console.log("[main] All workers started. Press Ctrl+C to stop.");
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`\n[main] Received ${signal}, shutting down...`);

  // Stop all pollers
  stopDerivePoller();
  stopChainIndexer();
  stopHlPoller();
  stopRetention();

  // Drain DB pool
  await shutdown();

  console.log("[main] Goodbye.");
  process.exit(0);
}

process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));

// Unhandled rejection logging
process.on("unhandledRejection", (reason) => {
  console.error("[main] Unhandled rejection:", reason);
});

// Start
void main();
