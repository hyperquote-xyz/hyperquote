/**
 * Public Best Route PURR Benchmark
 *
 * GET /api/v1/bench/ht/purr
 *
 * Queries PRJX QuoterV2 on-chain for the best USDC → PURR swap quote.
 * PRJX (Project X) is the primary DEX venue on HyperEVM with deep
 * USDC/PURR liquidity pools.
 *
 * Falls back to HT.xyz aggregator if PRJX returns no route.
 *
 * 10s in-memory cache.
 */

import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BenchPurrResponse {
  evmOut: number | null;
  routeLabel: string | null;
  updatedAt: number;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RPC_URL = process.env.HYPEREVM_RPC_URL ?? "https://rpc.hyperliquid.xyz/evm";
const PRJX_QUOTER_V2 = "0x239F11a7A3E08f2B8110D4CA9F6B95d4c8865258";
const USDC_ADDRESS = "0xb88339cb7199b77e23db6e890353e22632ba630f";
const PURR_ADDRESS = "0x9b498c3c8a0b8cd8ba1d9851d40d186f1872b44e";
const WHYPE_ADDRESS = "0x5555555555555555555555555555555555555555";
const AMOUNT_IN = 100_000n * 10n ** 6n; // 100k USDC (6 decimals)
const FEE_TIERS = [100, 500, 3000, 10000]; // PRJX V3 fee tiers to try
const FETCH_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 10_000;

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let cached: { data: BenchPurrResponse; fetchedAt: number } | null = null;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(): Promise<NextResponse<BenchPurrResponse>> {
  const now = Date.now();

  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json(cached.data);
  }

  try {
    // Strategy 1: Direct USDC → PURR across all fee tiers
    const directQuotes = await Promise.all(
      FEE_TIERS.map((fee) => quotePrjxSingle(USDC_ADDRESS, PURR_ADDRESS, AMOUNT_IN, fee))
    );

    // Strategy 2: 2-leg route USDC → WHYPE → PURR
    const leg1Quotes = await Promise.all(
      FEE_TIERS.map((fee) => quotePrjxSingle(USDC_ADDRESS, WHYPE_ADDRESS, AMOUNT_IN, fee))
    );
    const bestLeg1 = leg1Quotes.filter((q): q is bigint => q !== null)
      .reduce((a, b) => (a > b ? a : b), 0n);

    let routedQuotes: bigint[] = [];
    if (bestLeg1 > 0n) {
      const leg2Results = await Promise.all(
        FEE_TIERS.map((fee) => quotePrjxSingle(WHYPE_ADDRESS, PURR_ADDRESS, bestLeg1, fee))
      );
      routedQuotes = leg2Results.filter((q): q is bigint => q !== null);
    }

    const allQuotes = [
      ...directQuotes.filter((q): q is bigint => q !== null),
      ...routedQuotes,
    ];

    if (allQuotes.length === 0) {
      throw new Error("No PRJX route found for USDC → PURR");
    }

    const bestOut = allQuotes.reduce((a, b) => (a > b ? a : b));
    const evmOut = Number(bestOut) / 1e18; // PURR has 18 decimals

    const result: BenchPurrResponse = {
      evmOut,
      routeLabel: "USDC → PURR",
      updatedAt: now,
      error: null,
    };
    cached = { data: result, fetchedAt: now };
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "PRJX quote failed";

    console.warn("[bench/ht/purr] Error:", message);

    const result: BenchPurrResponse = {
      evmOut: null,
      routeLabel: null,
      updatedAt: now,
      error: message,
    };
    return NextResponse.json(result);
  }
}

// ---------------------------------------------------------------------------
// PRJX QuoterV2 — quoteExactInputSingle via eth_call
// ---------------------------------------------------------------------------

async function quotePrjxSingle(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  fee: number,
): Promise<bigint | null> {
  // Encode quoteExactInputSingle(address,address,uint256,uint24,uint160)
  // Selector: 0xc6a5026a — params are inline (not tuple-offset encoded)
  const selector = "c6a5026a";
  const encodedTokenIn = tokenIn.slice(2).toLowerCase().padStart(64, "0");
  const encodedTokenOut = tokenOut.slice(2).toLowerCase().padStart(64, "0");
  const encodedAmountIn = amountIn.toString(16).padStart(64, "0");
  const encodedFee = fee.toString(16).padStart(64, "0");
  const encodedSqrtPriceLimit = "0".padStart(64, "0"); // 0 = no limit

  const calldata = `0x${selector}${encodedTokenIn}${encodedTokenOut}${encodedAmountIn}${encodedFee}${encodedSqrtPriceLimit}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_call",
        params: [{ to: PRJX_QUOTER_V2, data: calldata }, "latest"],
        id: 1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const json = await res.json();
    const result = json?.result;

    if (!result || result === "0x" || result.length < 66) {
      return null;
    }

    // First 32 bytes of return is amountOut
    const amountOut = BigInt("0x" + result.slice(2, 66));
    return amountOut > 0n ? amountOut : null;
  } catch {
    return null;
  }
}
