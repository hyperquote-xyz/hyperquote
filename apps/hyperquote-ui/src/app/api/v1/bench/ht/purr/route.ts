/**
 * HT.xyz PURR Benchmark — EVM-only Swap Quote
 *
 * GET /api/v1/bench/ht/purr
 *
 * Calls HT.xyz core API (POST /trade/getSwapInfo)
 * with enableHyperCore: false → EVM-only DEX routing.
 *
 * 100,000 USDH → PURR.
 *   USDH has 6 decimals → raw input = 100000 * 10^6 = "100000000000"
 *   PURR has 18 decimals, but HT returns outputAmount already human-readable.
 *
 * When the direct USDH → PURR route fails, automatically tries multi-hop
 * routing through liquid intermediates (USDC, WHYPE, USD₮0).
 *
 * 10s in-memory cache. 10s timeout.
 */

import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HTPurrResponse {
  evmOut: number | null;
  routeLabel: string | null;
  updatedAt: number;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const HT_BASE_URL = "https://core.ht.xyz/api/v1/trade";
const HT_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 10_000;

// 100k USDH with 6 decimals = 100000 * 10^6
const INPUT_AMOUNT = "100000000000";
const USDH_ADDRESS = "0x111111a1a0667d36bd57c0a9f569b98057111111";
const PURR_ADDRESS = "0x9b498C3c8A0b8CD8BA1D9851d40D186F1872b44E";

/** Liquid intermediates for multi-hop when direct USDH→PURR fails */
const INTERMEDIATES = [
  { address: "0xb88339cb7199b77e23db6e890353e22632ba630f", symbol: "USDC", decimals: 6 },
  { address: "0x5555555555555555555555555555555555555555", symbol: "WHYPE", decimals: 18 },
  { address: "0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb", symbol: "USD₮0", decimals: 6 },
];

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let cached: { data: HTPurrResponse; fetchedAt: number } | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Call HT.xyz getSwapInfo for a specific pair. Returns human-readable output or null. */
async function htxyzSwap(
  inputAddress: string,
  outputAddress: string,
  inputAmount: string,
  signal: AbortSignal,
): Promise<{ outputAmount: number; rawOutputAmount: string } | null> {
  const res = await fetch(`${HT_BASE_URL}/getSwapInfo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inputAmount,
      slippage: 0.3,
      inputTokenAddress: inputAddress,
      outputTokenAddress: outputAddress,
      feeAddress: "0x0000000000000000000000000000000000000000",
      feeBps: 0,
      enableHyperCore: false,
    }),
    signal,
  });

  if (!res.ok) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json();
  const data = json.body ?? json;

  if (data.outputAmount == null) return null;

  const outputAmount = parseFloat(String(data.outputAmount));
  if (isNaN(outputAmount) || outputAmount <= 0) return null;

  return { outputAmount, rawOutputAmount: String(data.outputAmount) };
}

/**
 * Try multi-hop routing through intermediates.
 * For each intermediate, calls leg1 (USDH→intermediate) then leg2 (intermediate→PURR).
 * Returns the best result by output amount.
 */
async function tryMultiHop(
  signal: AbortSignal,
): Promise<{ evmOut: number; routeLabel: string } | null> {
  const results = await Promise.allSettled(
    INTERMEDIATES.map(async (intermediate) => {
      // Leg 1: USDH → intermediate
      const leg1 = await htxyzSwap(USDH_ADDRESS, intermediate.address, INPUT_AMOUNT, signal);
      if (!leg1) return null;

      // Convert leg1 human-readable output to raw amount for leg2 input
      const leg1RawOut = BigInt(
        Math.floor(leg1.outputAmount * 10 ** intermediate.decimals),
      ).toString();

      // Leg 2: intermediate → PURR
      const leg2 = await htxyzSwap(intermediate.address, PURR_ADDRESS, leg1RawOut, signal);
      if (!leg2) return null;

      return {
        evmOut: leg2.outputAmount,
        routeLabel: `USDH → ${intermediate.symbol} → PURR`,
      };
    }),
  );

  let best: { evmOut: number; routeLabel: string } | null = null;
  for (const r of results) {
    if (r.status !== "fulfilled" || r.value === null) continue;
    if (!best || r.value.evmOut > best.evmOut) {
      best = r.value;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(): Promise<NextResponse<HTPurrResponse>> {
  const now = Date.now();

  // Serve from cache if fresh
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json(cached.data);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HT_TIMEOUT_MS);

  try {
    // Step 1: Try direct USDH → PURR
    const direct = await htxyzSwap(USDH_ADDRESS, PURR_ADDRESS, INPUT_AMOUNT, controller.signal);

    if (direct) {
      clearTimeout(timeout);
      const result: HTPurrResponse = {
        evmOut: direct.outputAmount,
        routeLabel: "USDH → PURR",
        updatedAt: now,
        error: null,
      };
      cached = { data: result, fetchedAt: now };
      return NextResponse.json(result);
    }

    // Step 2: Direct failed — try multi-hop through intermediates
    if (process.env.NODE_ENV === "development") {
      console.debug("[bench/ht/purr] Direct USDH→PURR failed, trying multi-hop...");
    }

    const multiHop = await tryMultiHop(controller.signal);
    clearTimeout(timeout);

    if (multiHop) {
      if (process.env.NODE_ENV === "development") {
        console.debug("[bench/ht/purr] Multi-hop success:", multiHop.routeLabel);
      }
      const result: HTPurrResponse = {
        evmOut: multiHop.evmOut,
        routeLabel: multiHop.routeLabel,
        updatedAt: now,
        error: null,
      };
      cached = { data: result, fetchedAt: now };
      return NextResponse.json(result);
    }

    // Both direct and multi-hop failed
    throw new Error("No route found (direct or multi-hop)");
  } catch (err) {
    clearTimeout(timeout);
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? "HT.xyz request timed out (10s)"
          : err.message
        : "HT.xyz swap quote failed";

    console.warn("[bench/ht/purr] Error:", message);

    const result: HTPurrResponse = {
      evmOut: null,
      routeLabel: null,
      updatedAt: now,
      error: message,
    };

    return NextResponse.json(result);
  }
}
