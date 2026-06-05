/**
 * HT.xyz HYPE Benchmark — EVM-only Swap Quote
 *
 * GET /api/v1/bench/ht/purr
 *
 * Calls HT.xyz R1 quote API (GET /api/v1/trade/quote)
 * for EVM-only DEX routing.
 *
 * 100,000 USDC → HYPE.
 *   USDC has 6 decimals → raw input = 100000 * 10^6 = "100000000000"
 *   HYPE (WHYPE) has 18 decimals → outAmount is in wei, divide by 10^18.
 *
 * 10s in-memory cache. 10s timeout.
 */

import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HTHypeResponse {
  evmOut: number | null;
  routeLabel: string | null;
  updatedAt: number;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const HT_QUOTE_URL = "https://core.ht.xyz/api/v1/trade/quote";
const HT_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 10_000;

// 100k USDC with 6 decimals = 100000 * 10^6
const INPUT_AMOUNT = "100000000000";
const USDC_ADDRESS = "0xb88339cb7199b77e23db6e890353e22632ba630f";
const WHYPE_ADDRESS = "0x5555555555555555555555555555555555555555";
const SLIPPAGE_BPS = 50; // 0.5%

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let cached: { data: HTHypeResponse; fetchedAt: number } | null = null;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(): Promise<NextResponse<HTHypeResponse>> {
  const now = Date.now();

  // Serve from cache if fresh
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json(cached.data);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HT_TIMEOUT_MS);

  try {
    const params = new URLSearchParams({
      inputMint: USDC_ADDRESS,
      outputMint: WHYPE_ADDRESS,
      amount: INPUT_AMOUNT,
      slippageBps: String(SLIPPAGE_BPS),
    });

    const res = await fetch(`${HT_QUOTE_URL}?${params.toString()}`, {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`HT.xyz quote API returned HTTP ${res.status}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json();
    const data = json.body ?? json;

    if (data.outAmount == null) {
      throw new Error("No outAmount in HT.xyz quote response");
    }

    // outAmount is in HYPE wei (18 decimals) — convert to human-readable
    const outAmountRaw = BigInt(data.outAmount);
    const evmOut = Number(outAmountRaw) / 1e18;

    if (isNaN(evmOut) || evmOut <= 0) {
      throw new Error("Invalid outAmount from HT.xyz quote");
    }

    const routeLabel = "USDC → HYPE";

    const result: HTHypeResponse = {
      evmOut,
      routeLabel,
      updatedAt: now,
      error: null,
    };
    cached = { data: result, fetchedAt: now };
    return NextResponse.json(result);
  } catch (err) {
    clearTimeout(timeout);
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? "HT.xyz request timed out (10s)"
          : err.message
        : "HT.xyz swap quote failed";

    console.warn("[bench/ht/hype] Error:", message);

    const result: HTHypeResponse = {
      evmOut: null,
      routeLabel: null,
      updatedAt: now,
      error: message,
    };

    return NextResponse.json(result);
  }
}
