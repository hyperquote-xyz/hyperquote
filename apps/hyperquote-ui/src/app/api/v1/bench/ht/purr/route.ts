/**
 * HT.xyz PURR Benchmark — EVM-only Swap Quote
 *
 * GET /api/v1/bench/ht/purr
 *
 * Calls HT.xyz R1 quote API (GET /api/v1/trade/quote)
 * for EVM-only DEX routing.
 *
 * 100,000 USDC → PURR.
 *   USDC has 6 decimals → raw input = 100000 * 10^6 = "100000000000"
 *   Response toAmount is human-readable (not wei).
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

const HT_QUOTE_URL = "https://core.ht.xyz/api/v1/trade/quote";
const HT_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 10_000;

// 100k USDC with 6 decimals = 100000 * 10^6
const INPUT_AMOUNT = "100000000000";
const USDC_ADDRESS = "0xb88339cb7199b77e23db6e890353e22632ba630f";
const PURR_ADDRESS = "0x9b498c3c8a0b8cd8ba1d9851d40d186f1872b44e";
const DUMMY_RECEIVER = "0x0000000000000000000000000000000000000001";

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let cached: { data: HTPurrResponse; fetchedAt: number } | null = null;

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
    const params = new URLSearchParams({
      src: USDC_ADDRESS,
      dst: PURR_ADDRESS,
      amount: INPUT_AMOUNT,
      slippage: "0.3",
      receiver: DUMMY_RECEIVER,
      includeHyperCore: "false",
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

    if (json.error || !json.toAmount) {
      throw new Error(json.error ?? "No toAmount in HT.xyz response");
    }

    // toAmount is human-readable (e.g. "952380.95")
    const evmOut = parseFloat(json.toAmount);

    if (isNaN(evmOut) || evmOut <= 0) {
      throw new Error("Invalid toAmount from HT.xyz quote");
    }

    const routeLabel = "USDC → PURR";

    const result: HTPurrResponse = {
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
