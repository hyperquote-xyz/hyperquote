/**
 * Mock Feed Data — dev-only visual stress test for the Public RFQ Feed.
 *
 * Provides 28 realistic FeedRfqItem entries covering all status types,
 * token pairs, size ranges, and edge cases. Also includes a live update
 * generator that simulates SSE events.
 *
 * Activated by NEXT_PUBLIC_MOCK_MODE=true env var.
 * DO NOT import in production paths — tree-shaken when env is unset.
 */

import type { FeedRfqItem, FeedRfqStatus } from "@/hooks/useFeedStream";
import type { BadgeResult } from "@/lib/badges";

// ---------------------------------------------------------------------------
// Mock token definitions (match real addresses from src/config/tokens.ts)
// ---------------------------------------------------------------------------

const T = {
  HYPE: { address: "0x0000000000000000000000000000000000000000", symbol: "HYPE", decimals: 18 },
  PURR: { address: "0x9b498c3c8a0b8cd8ba1d9851d40d186f1872b44e", symbol: "PURR", decimals: 18 },
  USDC: { address: "0xb88339cb7199b77e23db6e890353e22632ba630f", symbol: "USDC", decimals: 6 },
  USDH: { address: "0x111111a1a0667d36bd57c0a9f569b98057111111", symbol: "USDH", decimals: 6 },
  UBTC: { address: "0x9FDBdA0A5e284c32744D2f17Ee5c74B284993463", symbol: "UBTC", decimals: 8 },
  UETH: { address: "0xBe6727B535545C67d5cAa73dEa54865B92CF7907", symbol: "UETH", decimals: 18 },
  RAM: { address: "0xa20d05e1467d0d5ef0020a5ed1c5100470621efc", symbol: "RAM", decimals: 18 },
  FEUSD: { address: "0x8a862fd6c12f9ad34c9c2ff45ab2b6712e8cea27", symbol: "feUSDC", decimals: 6 },
};

// Mock prices (USD) for amount computation
export const MOCK_PRICES: Record<string, number> = {
  HYPE: 25,
  PURR: 0.002,
  USDC: 1,
  USDH: 1,
  UBTC: 100_000,
  UETH: 3_500,
  RAM: 0.10,
  feUSDC: 1,
};

// ---------------------------------------------------------------------------
// Shared wallet addresses (appear in both feed + league)
// ---------------------------------------------------------------------------

const WALLETS = {
  // League makers
  MAKER_1: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045", // boost 1.5x Hypurr
  MAKER_3: "0x6b175474e89094c44da98b954eedeac495271d0f", // boost 2.0x Both
  MAKER_4: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // boost 1.25x Hypio
  MAKER_7: "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9", // boost 1.5x Hypurr
  // League takers
  TAKER_1: "0xbe0eb53f46cd790cd13851d5eff43d12404d33e8", // boost 1.0x None
  TAKER_2: "0xf977814e90da44bfa03b6295a0616a897441acec", // boost 1.5x Hypurr
  TAKER_3: "0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503", // boost 2.0x Both
  TAKER_5: "0x21a31ee1afc51d94c2efccaa2092ad1028285549", // boost 1.25x Hypio
  // Feed-only unique takers
  FEED_A: "0xaaaa1111bbbb2222cccc3333dddd4444eeee5555",
  FEED_B: "0xbbbb2222cccc3333dddd4444eeee5555ffff6666",
  FEED_C: "0xcccc3333dddd4444eeee5555ffff6666aaaa1111",
  FEED_D: "0xdddd4444eeee5555ffff6666aaaa1111bbbb2222",
};

// ---------------------------------------------------------------------------
// Badge map (cross-page consistency)
// ---------------------------------------------------------------------------

const MOCK_FEED_BADGE_MAP: Record<string, { hasHypio: boolean; hasHypurr: boolean }> = {
  [WALLETS.MAKER_1]: { hasHypio: false, hasHypurr: true },  // 1.5x
  [WALLETS.MAKER_3]: { hasHypio: true, hasHypurr: true },   // 2.0x
  [WALLETS.MAKER_4]: { hasHypio: true, hasHypurr: false },  // 1.25x
  [WALLETS.MAKER_7]: { hasHypio: false, hasHypurr: true },  // 1.5x
  [WALLETS.TAKER_2]: { hasHypio: false, hasHypurr: true },  // 1.5x
  [WALLETS.TAKER_3]: { hasHypio: true, hasHypurr: true },   // 2.0x
  [WALLETS.TAKER_5]: { hasHypio: true, hasHypurr: false },  // 1.25x
};

const DEFAULT_BADGE: BadgeResult = {
  hasHypio: false,
  hasHypurr: false,
  boostMultiplier: 1.0,
};

/** Look up mock badge for a feed taker address. */
export function getMockFeedBadge(address: string): BadgeResult {
  const entry = MOCK_FEED_BADGE_MAP[address.toLowerCase()];
  if (!entry) return DEFAULT_BADGE;
  const boost = (entry.hasHypio && entry.hasHypurr) ? 2.0
    : entry.hasHypurr ? 1.5
    : entry.hasHypio ? 1.25
    : 1.0;
  return { ...entry, boostMultiplier: boost };
}

// ---------------------------------------------------------------------------
// Amount helpers
// ---------------------------------------------------------------------------

function toRaw(usd: number, tokenSymbol: string, decimals: number): string {
  const price = MOCK_PRICES[tokenSymbol] ?? 1;
  const humanAmount = usd / price;
  // Use string math to avoid BigInt precision issues with large numbers
  const shifted = Math.floor(humanAmount * 10 ** Math.min(decimals, 15));
  if (decimals <= 15) {
    return shifted.toString();
  }
  // For 18-decimal tokens, pad remaining zeros
  return shifted.toString() + "0".repeat(decimals - 15);
}

function pad(n: number): string {
  return n.toString().padStart(3, "0");
}

// ---------------------------------------------------------------------------
// Static RFQ entry definitions
// ---------------------------------------------------------------------------

interface RfqDef {
  id: string;
  taker: string;
  tokenIn: typeof T.HYPE;
  tokenOut: typeof T.HYPE;
  kind: 0 | 1; // EXACT_IN | EXACT_OUT
  targetUsd: number;
  status: FeedRfqStatus;
  secsAgo: number;  // how long ago created
  ttlSecs: number;  // total TTL from creation (for OPEN items)
  quoteCount: number;
  fillTxHash: string | null;
}

const DEFS: RfqDef[] = [
  // --- OPEN (8) ---
  { id: "mock-rfq-001", taker: WALLETS.MAKER_1, tokenIn: T.USDC, tokenOut: T.HYPE,  kind: 0, targetUsd: 250_000, status: "OPEN",    secsAgo: 5,   ttlSecs: 45,  quoteCount: 3, fillTxHash: null },
  { id: "mock-rfq-002", taker: WALLETS.TAKER_2, tokenIn: T.USDH, tokenOut: T.PURR,  kind: 0, targetUsd: 50_000,  status: "OPEN",    secsAgo: 12,  ttlSecs: 60,  quoteCount: 1, fillTxHash: null },
  { id: "mock-rfq-003", taker: WALLETS.FEED_A,  tokenIn: T.USDC, tokenOut: T.UETH,  kind: 0, targetUsd: 100_000, status: "OPEN",    secsAgo: 20,  ttlSecs: 90,  quoteCount: 2, fillTxHash: null },
  { id: "mock-rfq-004", taker: WALLETS.MAKER_3, tokenIn: T.HYPE, tokenOut: T.USDC,  kind: 0, targetUsd: 500_000, status: "OPEN",    secsAgo: 8,   ttlSecs: 120, quoteCount: 5, fillTxHash: null },
  { id: "mock-rfq-005", taker: WALLETS.TAKER_5, tokenIn: T.USDC, tokenOut: T.RAM,   kind: 0, targetUsd: 25_000,  status: "OPEN",    secsAgo: 3,   ttlSecs: 30,  quoteCount: 0, fillTxHash: null },
  { id: "mock-rfq-006", taker: WALLETS.FEED_B,  tokenIn: T.UBTC, tokenOut: T.USDC,  kind: 0, targetUsd: 9_000_000, status: "OPEN",  secsAgo: 2,   ttlSecs: 600, quoteCount: 8, fillTxHash: null }, // whale, large TTL
  { id: "mock-rfq-007", taker: WALLETS.FEED_C,  tokenIn: T.PURR, tokenOut: T.HYPE,  kind: 0, targetUsd: 500,     status: "OPEN",    secsAgo: 45,  ttlSecs: 47,  quoteCount: 0, fillTxHash: null }, // 2s TTL remaining (urgent)
  { id: "mock-rfq-008", taker: WALLETS.MAKER_7, tokenIn: T.USDC, tokenOut: T.FEUSD, kind: 0, targetUsd: 150_000, status: "OPEN",    secsAgo: 15,  ttlSecs: 180, quoteCount: 2, fillTxHash: null },

  // --- QUOTED (3) ---
  { id: "mock-rfq-009", taker: WALLETS.TAKER_1, tokenIn: T.USDC, tokenOut: T.HYPE,  kind: 0, targetUsd: 75_000,  status: "QUOTED",  secsAgo: 30,  ttlSecs: 60,  quoteCount: 4, fillTxHash: null },
  { id: "mock-rfq-010", taker: WALLETS.MAKER_4, tokenIn: T.UETH, tokenOut: T.HYPE,  kind: 1, targetUsd: 2_500_000, status: "QUOTED", secsAgo: 10, ttlSecs: 120, quoteCount: 6, fillTxHash: null }, // EXACT_OUT
  { id: "mock-rfq-011", taker: WALLETS.FEED_D,  tokenIn: T.USDC, tokenOut: T.RAM,   kind: 0, targetUsd: 10_000,  status: "QUOTED",  secsAgo: 25,  ttlSecs: 45,  quoteCount: 2, fillTxHash: null },

  // --- FILLED (8) ---
  { id: "mock-rfq-012", taker: WALLETS.MAKER_1, tokenIn: T.HYPE, tokenOut: T.USDC,  kind: 0, targetUsd: 1_000_000, status: "FILLED", secsAgo: 60,  ttlSecs: 90,  quoteCount: 7, fillTxHash: "0xaabbccddee0012aabbccddee0012aabbccddee0012aabbccddee0012aabbccdd" },
  { id: "mock-rfq-013", taker: WALLETS.TAKER_3, tokenIn: T.USDH, tokenOut: T.PURR,  kind: 0, targetUsd: 750_000, status: "FILLED",  secsAgo: 120, ttlSecs: 60,  quoteCount: 5, fillTxHash: "0x1122334455660013112233445566001311223344556600131122334455660013" },
  { id: "mock-rfq-014", taker: WALLETS.FEED_A,  tokenIn: T.UBTC, tokenOut: T.USDC,  kind: 0, targetUsd: 5_000_000, status: "FILLED", secsAgo: 300, ttlSecs: 120, quoteCount: 9, fillTxHash: "0xffeeddccbbaa0014ffeeddccbbaa0014ffeeddccbbaa0014ffeeddccbbaa0014" },
  { id: "mock-rfq-015", taker: WALLETS.TAKER_2, tokenIn: T.USDC, tokenOut: T.UETH,  kind: 0, targetUsd: 2_500,   status: "FILLED",  secsAgo: 2,   ttlSecs: 30,  quoteCount: 1, fillTxHash: "0x9988776655440015998877665544001599887766554400159988776655440015" }, // instant fill
  { id: "mock-rfq-016", taker: WALLETS.MAKER_3, tokenIn: T.USDC, tokenOut: T.FEUSD, kind: 0, targetUsd: 500_000, status: "FILLED",  secsAgo: 180, ttlSecs: 90,  quoteCount: 3, fillTxHash: "0x5566778899aa00165566778899aa00165566778899aa00165566778899aa0016" },
  { id: "mock-rfq-017", taker: WALLETS.FEED_B,  tokenIn: T.PURR, tokenOut: T.HYPE,  kind: 0, targetUsd: 10_000,  status: "FILLED",  secsAgo: 600, ttlSecs: 60,  quoteCount: 2, fillTxHash: "0xaabb00cc11dd0017aabb00cc11dd0017aabb00cc11dd0017aabb00cc11dd0017" },
  { id: "mock-rfq-018", taker: WALLETS.TAKER_5, tokenIn: T.HYPE, tokenOut: T.USDC,  kind: 0, targetUsd: 50_000,  status: "FILLED",  secsAgo: 900, ttlSecs: 45,  quoteCount: 4, fillTxHash: "0x0011223344550018001122334455001800112233445500180011223344550018" },
  { id: "mock-rfq-019", taker: WALLETS.MAKER_4, tokenIn: T.USDC, tokenOut: T.HYPE,  kind: 1, targetUsd: 100_000, status: "FILLED",  secsAgo: 45,  ttlSecs: 90,  quoteCount: 3, fillTxHash: "0xeeff00112233001900eeff001122330019eeff00112233001900eeff00112233" }, // EXACT_OUT

  // --- EXPIRED (5) ---
  { id: "mock-rfq-020", taker: WALLETS.FEED_C,  tokenIn: T.USDC, tokenOut: T.UETH,  kind: 0, targetUsd: 75_000,  status: "EXPIRED", secsAgo: 400, ttlSecs: 60,  quoteCount: 0, fillTxHash: null },
  { id: "mock-rfq-021", taker: WALLETS.TAKER_1, tokenIn: T.USDH, tokenOut: T.PURR,  kind: 0, targetUsd: 150_000, status: "EXPIRED", secsAgo: 500, ttlSecs: 90,  quoteCount: 2, fillTxHash: null },
  { id: "mock-rfq-022", taker: WALLETS.FEED_D,  tokenIn: T.UBTC, tokenOut: T.USDC,  kind: 0, targetUsd: 250_000, status: "EXPIRED", secsAgo: 700, ttlSecs: 120, quoteCount: 1, fillTxHash: null },
  { id: "mock-rfq-023", taker: WALLETS.MAKER_7, tokenIn: T.USDC, tokenOut: T.RAM,   kind: 0, targetUsd: 25_000,  status: "EXPIRED", secsAgo: 350, ttlSecs: 45,  quoteCount: 0, fillTxHash: null },
  { id: "mock-rfq-024", taker: WALLETS.FEED_A,  tokenIn: T.USDC, tokenOut: T.FEUSD, kind: 0, targetUsd: 500_000, status: "EXPIRED", secsAgo: 450, ttlSecs: 60,  quoteCount: 3, fillTxHash: null },

  // --- KILLED (4) ---
  { id: "mock-rfq-025", taker: WALLETS.TAKER_3, tokenIn: T.USDC, tokenOut: T.HYPE,  kind: 0, targetUsd: 1_000_000, status: "KILLED", secsAgo: 200, ttlSecs: 90,  quoteCount: 5, fillTxHash: null },
  { id: "mock-rfq-026", taker: WALLETS.FEED_B,  tokenIn: T.UETH, tokenOut: T.HYPE,  kind: 1, targetUsd: 750_000, status: "KILLED",  secsAgo: 250, ttlSecs: 60,  quoteCount: 3, fillTxHash: null }, // EXACT_OUT
  { id: "mock-rfq-027", taker: WALLETS.MAKER_1, tokenIn: T.USDC, tokenOut: T.FEUSD, kind: 0, targetUsd: 50_000,  status: "KILLED",  secsAgo: 150, ttlSecs: 45,  quoteCount: 1, fillTxHash: null },
  { id: "mock-rfq-028", taker: WALLETS.FEED_C,  tokenIn: T.HYPE, tokenOut: T.USDC,  kind: 0, targetUsd: 25_000,  status: "KILLED",  secsAgo: 180, ttlSecs: 30,  quoteCount: 0, fillTxHash: null },
];

// ---------------------------------------------------------------------------
// Build mock items from definitions
// ---------------------------------------------------------------------------

function buildItem(def: RfqDef, now: number): FeedRfqItem {
  const isExactIn = def.kind === 0;
  const pricingToken = isExactIn ? def.tokenIn : def.tokenOut;
  const rawAmount = toRaw(def.targetUsd, pricingToken.symbol, pricingToken.decimals);

  const createdAt = new Date(now - def.secsAgo * 1000).toISOString();
  const expiry = def.status === "OPEN" || def.status === "QUOTED"
    ? Math.floor(now / 1000) + (def.ttlSecs - def.secsAgo)
    : Math.floor(now / 1000) - 60; // expired/filled/killed: past expiry

  return {
    id: def.id,
    taker: def.taker,
    tokenIn: def.tokenIn,
    tokenOut: def.tokenOut,
    kind: def.kind,
    amountIn: isExactIn ? rawAmount : null,
    amountOut: isExactIn ? null : rawAmount,
    expiry,
    status: def.status,
    quoteCount: def.quoteCount,
    fillTxHash: def.fillTxHash,
    createdAt,
  };
}

/**
 * Build the initial set of 28 mock feed items.
 * Call at component mount — uses Date.now() for relative timestamps.
 */
export function buildMockFeedItems(): FeedRfqItem[] {
  const now = Date.now();
  return DEFS.map((def) => buildItem(def, now));
}

// ---------------------------------------------------------------------------
// Pre-computed notionals map
// ---------------------------------------------------------------------------

export const MOCK_FEED_NOTIONALS: Map<string, number> = new Map(
  DEFS.map((def) => [def.id, def.targetUsd])
);

// ---------------------------------------------------------------------------
// Live update generator
// ---------------------------------------------------------------------------

const TOKEN_PAIRS: Array<{ tokenIn: typeof T.HYPE; tokenOut: typeof T.HYPE }> = [
  { tokenIn: T.USDC, tokenOut: T.HYPE },
  { tokenIn: T.HYPE, tokenOut: T.USDC },
  { tokenIn: T.USDH, tokenOut: T.PURR },
  { tokenIn: T.USDC, tokenOut: T.UETH },
  { tokenIn: T.UBTC, tokenOut: T.USDC },
  { tokenIn: T.USDC, tokenOut: T.RAM },
  { tokenIn: T.USDC, tokenOut: T.FEUSD },
  { tokenIn: T.PURR, tokenOut: T.HYPE },
  { tokenIn: T.UETH, tokenOut: T.HYPE },
];

const ALL_TAKERS = Object.values(WALLETS);
let liveCounter = 0;

/**
 * Generate a new random OPEN RFQ for simulated SSE injection.
 * Returns the item and its pre-computed USD notional.
 */
export function generateMockRfq(): { item: FeedRfqItem; notionalUsd: number } {
  liveCounter++;
  const now = Date.now();
  const pair = TOKEN_PAIRS[Math.floor(Math.random() * TOKEN_PAIRS.length)];
  const taker = ALL_TAKERS[Math.floor(Math.random() * ALL_TAKERS.length)];

  // Random size between $10K and $500K
  const sizes = [10_000, 25_000, 50_000, 75_000, 100_000, 150_000, 250_000, 500_000];
  const targetUsd = sizes[Math.floor(Math.random() * sizes.length)];

  const kind = Math.random() < 0.15 ? 1 : 0; // 15% EXACT_OUT
  const pricingToken = kind === 0 ? pair.tokenIn : pair.tokenOut;
  const rawAmount = toRaw(targetUsd, pricingToken.symbol, pricingToken.decimals);

  const ttlSecs = 30 + Math.floor(Math.random() * 90); // 30-120s
  const id = `mock-rfq-live-${pad(liveCounter)}`;

  const item: FeedRfqItem = {
    id,
    taker,
    tokenIn: pair.tokenIn,
    tokenOut: pair.tokenOut,
    kind,
    amountIn: kind === 0 ? rawAmount : null,
    amountOut: kind === 1 ? rawAmount : null,
    expiry: Math.floor(now / 1000) + ttlSecs,
    status: "OPEN",
    quoteCount: 0,
    fillTxHash: null,
    createdAt: new Date(now).toISOString(),
  };

  return { item, notionalUsd: targetUsd };
}
