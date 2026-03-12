/**
 * Test Data Seed — Fills, FeedFills, FeedRfqs
 *
 * Populates the local dev database with realistic trading activity so the
 * leaderboard, points, league, and feed pages render with real data.
 *
 * Run: npx tsx prisma/seed-test-data.ts
 * Idempotent: uses upsert on txHash/id, safe to run repeatedly.
 */

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { computePoints } from "../src/lib/points.js";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || "file:./dev.db",
});
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Wallets
// ---------------------------------------------------------------------------

const WALLETS = {
  makerHeavy: "0xaaaa000000000000000000000000000000000001",
  makerMedium: "0xbbbb000000000000000000000000000000000002",
  makerLight: "0xcccc000000000000000000000000000000000003",
  takerHeavy: "0xdddd000000000000000000000000000000000004",
  takerMedium: "0xeeee000000000000000000000000000000000005",
  takerLight: "0xffff000000000000000000000000000000000006",
} as const;

// ---------------------------------------------------------------------------
// Tokens (matching config/tokens.ts addresses, lowercased)
// ---------------------------------------------------------------------------

interface TokenDef {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
}

const USDC: TokenDef = {
  address: "0xb88339cb7199b77e23db6e890353e22632ba630f",
  symbol: "USDC",
  name: "USD Coin",
  decimals: 6,
};

const HYPE: TokenDef = {
  address: "0x0000000000000000000000000000000000000000",
  symbol: "HYPE",
  name: "HyperEVM Native Token",
  decimals: 18,
};

const KHYPE: TokenDef = {
  address: "0xfd739d4e423301ce9385c1fb8850539d657c296d",
  symbol: "kHYPE",
  name: "Kinetiq kHYPE",
  decimals: 18,
};

const PURR: TokenDef = {
  address: "0x9b498c3c8a0b8cd8ba1d9851d40d186f1872b44e",
  symbol: "PURR",
  name: "Purr",
  decimals: 18,
};

const UBTC: TokenDef = {
  address: "0x9fdbda0a5e284c32744d2f17ee5c74b284993463",
  symbol: "UBTC",
  name: "Unit Bitcoin",
  decimals: 8,
};

// ---------------------------------------------------------------------------
// Token pairs for fills
// ---------------------------------------------------------------------------

interface TokenPair {
  tokenIn: TokenDef;
  tokenOut: TokenDef;
  /** Approximate price of tokenIn in USD (for generating realistic amounts) */
  priceInUsd: number;
}

const PAIRS: TokenPair[] = [
  { tokenIn: USDC, tokenOut: HYPE, priceInUsd: 1 },
  { tokenIn: USDC, tokenOut: KHYPE, priceInUsd: 1 },
  { tokenIn: HYPE, tokenOut: PURR, priceInUsd: 25 },
  { tokenIn: USDC, tokenOut: UBTC, priceInUsd: 1 },
];

// ---------------------------------------------------------------------------
// Fill definitions
// ---------------------------------------------------------------------------

interface FillDef {
  maker: string;
  taker: string;
  pairIdx: number;
  amountInUsd: number;
  improvementBps: number;
  isPrivate: boolean;
  /** Days ago (0 = today, 29 = ~30 days ago) */
  daysAgo: number;
}

const FILLS: FillDef[] = [
  // ── Heavy maker (0xaaaa) — 15 fills, high volume ──
  { maker: WALLETS.makerHeavy, taker: WALLETS.takerHeavy, pairIdx: 0, amountInUsd: 150_000, improvementBps: 35, isPrivate: true, daysAgo: 1 },
  { maker: WALLETS.makerHeavy, taker: WALLETS.takerHeavy, pairIdx: 0, amountInUsd: 120_000, improvementBps: 28, isPrivate: false, daysAgo: 2 },
  { maker: WALLETS.makerHeavy, taker: WALLETS.takerMedium, pairIdx: 1, amountInUsd: 80_000, improvementBps: 22, isPrivate: true, daysAgo: 3 },
  { maker: WALLETS.makerHeavy, taker: WALLETS.takerHeavy, pairIdx: 0, amountInUsd: 200_000, improvementBps: 40, isPrivate: true, daysAgo: 4 },
  { maker: WALLETS.makerHeavy, taker: WALLETS.takerLight, pairIdx: 2, amountInUsd: 50_000, improvementBps: 15, isPrivate: false, daysAgo: 5 },
  { maker: WALLETS.makerHeavy, taker: WALLETS.takerMedium, pairIdx: 0, amountInUsd: 95_000, improvementBps: 18, isPrivate: false, daysAgo: 7 },
  { maker: WALLETS.makerHeavy, taker: WALLETS.takerHeavy, pairIdx: 3, amountInUsd: 180_000, improvementBps: 30, isPrivate: true, daysAgo: 8 },
  { maker: WALLETS.makerHeavy, taker: WALLETS.takerMedium, pairIdx: 1, amountInUsd: 65_000, improvementBps: 12, isPrivate: false, daysAgo: 10 },
  { maker: WALLETS.makerHeavy, taker: WALLETS.takerLight, pairIdx: 0, amountInUsd: 30_000, improvementBps: 8, isPrivate: false, daysAgo: 14 },
  { maker: WALLETS.makerHeavy, taker: WALLETS.takerHeavy, pairIdx: 0, amountInUsd: 110_000, improvementBps: 25, isPrivate: false, daysAgo: 18 },
  { maker: WALLETS.makerHeavy, taker: WALLETS.takerMedium, pairIdx: 2, amountInUsd: 45_000, improvementBps: 10, isPrivate: false, daysAgo: 20 },
  { maker: WALLETS.makerHeavy, taker: WALLETS.takerHeavy, pairIdx: 0, amountInUsd: 160_000, improvementBps: 32, isPrivate: true, daysAgo: 22 },
  { maker: WALLETS.makerHeavy, taker: WALLETS.takerLight, pairIdx: 1, amountInUsd: 25_000, improvementBps: 5, isPrivate: false, daysAgo: 24 },
  { maker: WALLETS.makerHeavy, taker: WALLETS.takerMedium, pairIdx: 0, amountInUsd: 75_000, improvementBps: 20, isPrivate: false, daysAgo: 26 },
  { maker: WALLETS.makerHeavy, taker: WALLETS.takerHeavy, pairIdx: 3, amountInUsd: 130_000, improvementBps: 27, isPrivate: false, daysAgo: 28 },

  // ── Medium maker (0xbbbb) — 10 fills ──
  { maker: WALLETS.makerMedium, taker: WALLETS.takerHeavy, pairIdx: 0, amountInUsd: 60_000, improvementBps: 18, isPrivate: false, daysAgo: 1 },
  { maker: WALLETS.makerMedium, taker: WALLETS.takerMedium, pairIdx: 1, amountInUsd: 45_000, improvementBps: 14, isPrivate: false, daysAgo: 3 },
  { maker: WALLETS.makerMedium, taker: WALLETS.takerLight, pairIdx: 0, amountInUsd: 35_000, improvementBps: 22, isPrivate: false, daysAgo: 5 },
  { maker: WALLETS.makerMedium, taker: WALLETS.takerHeavy, pairIdx: 2, amountInUsd: 80_000, improvementBps: 30, isPrivate: true, daysAgo: 6 },
  { maker: WALLETS.makerMedium, taker: WALLETS.takerMedium, pairIdx: 0, amountInUsd: 55_000, improvementBps: 16, isPrivate: false, daysAgo: 9 },
  { maker: WALLETS.makerMedium, taker: WALLETS.takerHeavy, pairIdx: 3, amountInUsd: 70_000, improvementBps: 25, isPrivate: false, daysAgo: 12 },
  { maker: WALLETS.makerMedium, taker: WALLETS.takerLight, pairIdx: 1, amountInUsd: 20_000, improvementBps: 8, isPrivate: false, daysAgo: 16 },
  { maker: WALLETS.makerMedium, taker: WALLETS.takerMedium, pairIdx: 0, amountInUsd: 40_000, improvementBps: -3, isPrivate: false, daysAgo: 20 },
  { maker: WALLETS.makerMedium, taker: WALLETS.takerHeavy, pairIdx: 0, amountInUsd: 50_000, improvementBps: 12, isPrivate: false, daysAgo: 25 },
  { maker: WALLETS.makerMedium, taker: WALLETS.takerMedium, pairIdx: 2, amountInUsd: 30_000, improvementBps: 10, isPrivate: false, daysAgo: 29 },

  // ── Light maker (0xcccc) — 5 fills ──
  { maker: WALLETS.makerLight, taker: WALLETS.takerHeavy, pairIdx: 0, amountInUsd: 15_000, improvementBps: 10, isPrivate: false, daysAgo: 2 },
  { maker: WALLETS.makerLight, taker: WALLETS.takerMedium, pairIdx: 1, amountInUsd: 8_000, improvementBps: 5, isPrivate: false, daysAgo: 8 },
  { maker: WALLETS.makerLight, taker: WALLETS.takerLight, pairIdx: 0, amountInUsd: 12_000, improvementBps: 15, isPrivate: false, daysAgo: 15 },
  { maker: WALLETS.makerLight, taker: WALLETS.takerHeavy, pairIdx: 2, amountInUsd: 5_000, improvementBps: -5, isPrivate: false, daysAgo: 22 },
  { maker: WALLETS.makerLight, taker: WALLETS.takerMedium, pairIdx: 0, amountInUsd: 10_000, improvementBps: 8, isPrivate: false, daysAgo: 28 },
];

// ---------------------------------------------------------------------------
// Active RFQ definitions
// ---------------------------------------------------------------------------

interface RfqDef {
  taker: string;
  tokenIn: TokenDef;
  tokenOut: TokenDef;
  kind: number; // 0=EXACT_IN, 1=EXACT_OUT
  amountIn: string | null;
  amountOut: string | null;
  status: string;
  quoteCount: number;
  visibility: string;
  /** Minutes from now for expiry (negative = already expired) */
  expiryMinutes: number;
}

const RFQS: RfqDef[] = [
  // Active OPEN RFQs
  { taker: WALLETS.takerHeavy, tokenIn: USDC, tokenOut: HYPE, kind: 0, amountIn: "50000000000", amountOut: null, status: "OPEN", quoteCount: 0, visibility: "public", expiryMinutes: 5 },
  { taker: WALLETS.takerMedium, tokenIn: USDC, tokenOut: KHYPE, kind: 0, amountIn: "25000000000", amountOut: null, status: "OPEN", quoteCount: 2, visibility: "public", expiryMinutes: 4 },
  { taker: WALLETS.takerLight, tokenIn: HYPE, tokenOut: PURR, kind: 0, amountIn: "1000000000000000000000", amountOut: null, status: "OPEN", quoteCount: 1, visibility: "public", expiryMinutes: 3 },
  { taker: WALLETS.takerHeavy, tokenIn: USDC, tokenOut: UBTC, kind: 0, amountIn: "100000000000", amountOut: null, status: "OPEN", quoteCount: 3, visibility: "private", expiryMinutes: 6 },
  { taker: WALLETS.takerMedium, tokenIn: HYPE, tokenOut: USDC, kind: 1, amountIn: null, amountOut: "10000000000", status: "OPEN", quoteCount: 0, visibility: "public", expiryMinutes: 5 },
  // Historical FILLED RFQs
  { taker: WALLETS.takerHeavy, tokenIn: USDC, tokenOut: HYPE, kind: 0, amountIn: "75000000000", amountOut: null, status: "FILLED", quoteCount: 2, visibility: "public", expiryMinutes: -60 },
  { taker: WALLETS.takerMedium, tokenIn: USDC, tokenOut: KHYPE, kind: 0, amountIn: "30000000000", amountOut: null, status: "FILLED", quoteCount: 1, visibility: "public", expiryMinutes: -120 },
  { taker: WALLETS.takerLight, tokenIn: HYPE, tokenOut: PURR, kind: 0, amountIn: "500000000000000000000", amountOut: null, status: "EXPIRED", quoteCount: 0, visibility: "public", expiryMinutes: -30 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgoDate(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

function fakeTxHash(index: number): string {
  return `0x${index.toString(16).padStart(64, "a")}`;
}

function fakeRfqId(index: number): string {
  const hex = index.toString(16).padStart(8, "0");
  return `rfq-${hex}-0000-0000-0000-000000000000`;
}

/** Convert USD notional to a raw BigInt string for the given token */
function usdToRawAmount(usd: number, token: TokenDef, priceUsd: number): string {
  const tokenAmount = usd / priceUsd;
  const raw = BigInt(Math.round(tokenAmount * 10 ** token.decimals));
  return raw.toString();
}

function tokenToJSON(t: TokenDef): string {
  return JSON.stringify({
    address: t.address,
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("🧪 Seeding test data (fills, feed fills, active RFQs)...\n");

  // ── Fills + FeedFills ──
  console.log("📊 Seeding fills...");
  let fillCount = 0;

  for (let i = 0; i < FILLS.length; i++) {
    const f = FILLS[i];
    const pair = PAIRS[f.pairIdx];
    const txHash = fakeTxHash(i + 1);
    const rfqId = fakeRfqId(i + 1);
    const timestamp = daysAgoDate(f.daysAgo);

    const amountIn = usdToRawAmount(f.amountInUsd, pair.tokenIn, pair.priceInUsd);
    // Approximate output amount (1:1 ratio adjusted by improvement)
    const improvementFactor = 1 + f.improvementBps / 10000;
    const amountOut = usdToRawAmount(
      f.amountInUsd * improvementFactor,
      pair.tokenOut,
      pair.priceInUsd
    );
    const baselineOut = usdToRawAmount(f.amountInUsd, pair.tokenOut, pair.priceInUsd);

    // Compute points
    const makerResult = computePoints({
      role: "maker",
      notionalUsd: f.amountInUsd,
      improvementBps: f.improvementBps,
      benchmarkAvailable: true,
      isPrivate: f.isPrivate,
      maker: f.maker,
      taker: f.taker,
    });
    const takerResult = computePoints({
      role: "taker",
      notionalUsd: f.amountInUsd,
      improvementBps: f.improvementBps,
      benchmarkAvailable: true,
      isPrivate: f.isPrivate,
      maker: f.maker,
      taker: f.taker,
    });

    // Upsert Fill
    await prisma.fill.upsert({
      where: { txHash },
      update: {
        rfqId,
        timestamp,
        taker: f.taker,
        maker: f.maker,
        tokenIn: pair.tokenIn.address,
        tokenOut: pair.tokenOut.address,
        amountIn,
        amountOut,
        amountInUsd: f.amountInUsd,
        baselineOut,
        improvementBps: f.improvementBps,
        takerPoints: takerResult.points,
        makerPoints: makerResult.points,
      },
      create: {
        txHash,
        rfqId,
        timestamp,
        taker: f.taker,
        maker: f.maker,
        tokenIn: pair.tokenIn.address,
        tokenOut: pair.tokenOut.address,
        amountIn,
        amountOut,
        amountInUsd: f.amountInUsd,
        baselineOut,
        improvementBps: f.improvementBps,
        takerPoints: takerResult.points,
        makerPoints: makerResult.points,
      },
    });

    // Upsert FeedFill
    await prisma.feedFill.upsert({
      where: { txHash },
      update: {
        rfqId,
        filledAt: timestamp,
        maker: f.maker,
        taker: f.taker,
        tokenIn: pair.tokenIn.address,
        tokenOut: pair.tokenOut.address,
        amountIn,
        amountOut,
        notionalUsd: f.amountInUsd,
        isPrivate: f.isPrivate,
        benchmarkSource: "sor",
        benchmarkOut: baselineOut,
        improvementBps: f.improvementBps,
        benchmarkAvailable: true,
      },
      create: {
        txHash,
        rfqId,
        filledAt: timestamp,
        maker: f.maker,
        taker: f.taker,
        tokenIn: pair.tokenIn.address,
        tokenOut: pair.tokenOut.address,
        amountIn,
        amountOut,
        notionalUsd: f.amountInUsd,
        isPrivate: f.isPrivate,
        benchmarkSource: "sor",
        benchmarkOut: baselineOut,
        improvementBps: f.improvementBps,
        benchmarkAvailable: true,
      },
    });

    fillCount++;
    const tag = f.isPrivate ? "🔒" : "🌐";
    console.log(
      `  ${tag} $${f.amountInUsd.toLocaleString().padStart(8)} ${pair.tokenIn.symbol}→${pair.tokenOut.symbol} ` +
      `+${f.improvementBps}bps  maker=${makerResult.points.toFixed(1)}pts taker=${takerResult.points.toFixed(1)}pts  ` +
      `(${f.daysAgo}d ago)`
    );
  }
  console.log(`  → ${fillCount} fills + feed fills seeded\n`);

  // ── FeedRfqs ──
  console.log("📝 Seeding RFQs...");
  const nowSec = Math.floor(Date.now() / 1000);

  for (let i = 0; i < RFQS.length; i++) {
    const r = RFQS[i];
    const id = fakeRfqId(1000 + i);
    const expiry = nowSec + r.expiryMinutes * 60;
    const fillTxHash = r.status === "FILLED" ? fakeTxHash(1000 + i) : null;

    await prisma.feedRfq.upsert({
      where: { id },
      update: {
        taker: r.taker,
        tokenIn: r.tokenIn.address,
        tokenOut: r.tokenOut.address,
        tokenInJson: tokenToJSON(r.tokenIn),
        tokenOutJson: tokenToJSON(r.tokenOut),
        kind: r.kind,
        amountIn: r.amountIn,
        amountOut: r.amountOut,
        expiry,
        status: r.status,
        quoteCount: r.quoteCount,
        visibility: r.visibility,
        fillTxHash,
      },
      create: {
        id,
        taker: r.taker,
        tokenIn: r.tokenIn.address,
        tokenOut: r.tokenOut.address,
        tokenInJson: tokenToJSON(r.tokenIn),
        tokenOutJson: tokenToJSON(r.tokenOut),
        kind: r.kind,
        amountIn: r.amountIn,
        amountOut: r.amountOut,
        expiry,
        status: r.status,
        quoteCount: r.quoteCount,
        visibility: r.visibility,
        fillTxHash,
      },
    });

    const statusIcon = r.status === "OPEN" ? "🟢" : r.status === "FILLED" ? "✅" : "⏰";
    console.log(
      `  ${statusIcon} [${r.status.padEnd(7)}] ${r.tokenIn.symbol}→${r.tokenOut.symbol} ` +
      `${r.visibility} q=${r.quoteCount} exp=${r.expiryMinutes > 0 ? `+${r.expiryMinutes}m` : `${r.expiryMinutes}m`}`
    );
  }
  console.log(`  → ${RFQS.length} RFQs seeded\n`);

  // ── Summary ──
  const fills = await prisma.fill.count();
  const feedFills = await prisma.feedFill.count();
  const feedRfqs = await prisma.feedRfq.count();
  const openRfqs = await prisma.feedRfq.count({ where: { status: "OPEN" } });

  console.log("📊 Database summary:");
  console.log(`  Fills:      ${fills}`);
  console.log(`  Feed Fills: ${feedFills}`);
  console.log(`  Feed RFQs:  ${feedRfqs} (${openRfqs} OPEN)`);
  console.log("\n✅ Test data seed complete.");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
