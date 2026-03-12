/**
 * HyperCore PURR Benchmark — Spot Price + Orderbook Simulation
 *
 * GET /api/v1/bench/hypercore/purr
 *
 * Fetches the PURR L2 orderbook from Hyperliquid, computes:
 *   - Mid-price (spot reference in quote-stable terms)
 *   - RFQ reference output (100k / midPrice, zero-slippage ideal)
 *   - HyperCore market-buy output (walk asks for $100k)
 *   - Slippage vs RFQ reference
 *
 * Stable routing note:
 *   HL PURR spot is quoted in USDC. We assume all stables (USDH, USDC,
 *   USDTO) are 1:1 for this benchmark. The orderbook walk simulates
 *   spending 100,000 of the venue's quote stable, equivalent to 100k USDH.
 *
 * 10s in-memory cache. 5s fetch timeout.
 */

import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HyperCorePurrResponse {
  spotPrice: number | null;
  rfqRefOut: number | null;
  hypercoreOut: number | null;
  hypercoreSlippagePct: number | null;
  updatedAt: number;
  error: string | null;
}

interface L2Level {
  px: string;
  sz: string;
  n: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const HL_API_URL = "https://api.hyperliquid.xyz/info";
const FETCH_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 10_000;
const TRADE_SIZE_USD = 100_000;

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let cached: { data: HyperCorePurrResponse; fetchedAt: number } | null = null;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(): Promise<NextResponse<HyperCorePurrResponse>> {
  const now = Date.now();

  // Serve from cache if fresh
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json(cached.data);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(HL_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "l2Book", coin: "PURR", nSigFigs: 2 }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Hyperliquid API returned HTTP ${res.status}`);
    }

    const data = await res.json();
    const levels = data?.levels;

    if (
      !levels ||
      !Array.isArray(levels) ||
      levels.length < 2 ||
      !levels[0]?.length ||
      !levels[1]?.length
    ) {
      throw new Error("Invalid orderbook structure from Hyperliquid");
    }

    // Hyperliquid l2Book: levels[0] = bids (descending), levels[1] = asks (ascending)
    // PURR is quoted in USDC on HL. We treat USDC ≡ USDH ≡ USDTO at 1:1 for
    // this benchmark, so prices are directly in "stable-dollar" terms.
    const bids: L2Level[] = levels[0]; // buy orders, best (highest) bid first
    const asks: L2Level[] = levels[1]; // sell orders, best (lowest) ask first

    const bestBid = parseFloat(bids[0].px);
    const bestAsk = parseFloat(asks[0].px);

    if (isNaN(bestBid) || isNaN(bestAsk) || bestBid <= 0 || bestAsk <= 0) {
      throw new Error("Invalid bid/ask prices");
    }

    const spotPrice = (bestBid + bestAsk) / 2;

    // RFQ reference: zero-slippage ideal at mid-price
    // Assumes 100k USDH ≡ 100k USDC (1:1 stable assumption)
    const rfqRefOut = TRADE_SIZE_USD / spotPrice;

    // Walk asks simulating $100k market buy (in quote-stable terms)
    const hypercoreOut = walkAsks(asks, TRADE_SIZE_USD);

    let hypercoreSlippagePct: number | null = null;
    if (hypercoreOut !== null && rfqRefOut > 0) {
      hypercoreSlippagePct =
        ((rfqRefOut - hypercoreOut) / rfqRefOut) * 100;
    }

    const result: HyperCorePurrResponse = {
      spotPrice,
      rfqRefOut,
      hypercoreOut,
      hypercoreSlippagePct,
      updatedAt: now,
      error: hypercoreOut === null ? "Orderbook too thin for $100k" : null,
    };

    cached = { data: result, fetchedAt: now };
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? "Hyperliquid request timed out (5s)"
          : err.message
        : "HyperCore benchmark failed";

    console.warn("[bench/hypercore/purr] Error:", message);

    const result: HyperCorePurrResponse = {
      spotPrice: null,
      rfqRefOut: null,
      hypercoreOut: null,
      hypercoreSlippagePct: null,
      updatedAt: now,
      error: message,
    };

    return NextResponse.json(result);
  }
}

// ---------------------------------------------------------------------------
// Orderbook walk — simulate market buy
// ---------------------------------------------------------------------------

function walkAsks(asks: L2Level[], usdAmount: number): number | null {
  let usdRemaining = usdAmount;
  let tokensReceived = 0;

  for (const level of asks) {
    const px = parseFloat(level.px);
    const sz = parseFloat(level.sz);
    if (isNaN(px) || isNaN(sz) || px <= 0 || sz <= 0) continue;

    const levelUsd = px * sz;

    if (levelUsd >= usdRemaining) {
      tokensReceived += usdRemaining / px;
      usdRemaining = 0;
      break;
    }

    tokensReceived += sz;
    usdRemaining -= levelUsd;
  }

  // Book too thin — couldn't fill entire order
  if (usdRemaining > 0) return null;

  return tokensReceived;
}
