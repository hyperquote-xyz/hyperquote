/**
 * GET /api/v1/agent/venues — Query venue pricing (role: monitor)
 *
 * Query params:
 *   tokenIn   — Input token address or symbol
 *   tokenOut  — Output token address or symbol
 *   amountIn  — Raw BigInt string (required)
 *
 * Delegates to estimateVenues() — runs server-side.
 * Returns HyperCore + DEX pricing comparison.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateAgent, requireRole, logActivity } from "@/lib/agentAuth";
import { estimateVenues } from "@/lib/venueComparison";
import { getTokenByAddress, getTokenBySymbol } from "@/config/tokens";
import type { Token } from "@/types";

// ---------------------------------------------------------------------------
// Response cache — venue estimates are expensive (multiple RPC + DEX calls)
// TTL = 15s is short enough for price freshness, long enough to absorb bursts
// ---------------------------------------------------------------------------

const VENUE_CACHE_TTL_MS = 15_000;
const MAX_CACHE_ENTRIES = 200;

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

const venueCache = new Map<string, CacheEntry>();

function getCacheKey(tokenIn: string, tokenOut: string, amountIn: string): string {
  return `${tokenIn.toLowerCase()}:${tokenOut.toLowerCase()}:${amountIn}`;
}

function getCachedResult(key: string): unknown | null {
  const entry = venueCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    venueCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedResult(key: string, data: unknown): void {
  // Evict oldest entries if cache is full
  if (venueCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = venueCache.keys().next().value;
    if (firstKey) venueCache.delete(firstKey);
  }
  venueCache.set(key, {
    data,
    expiresAt: Date.now() + VENUE_CACHE_TTL_MS,
  });
}

export async function GET(request: NextRequest) {
  const { agent, error } = await authenticateAgent(request);
  if (error) return error;

  const roleError = requireRole(agent, "monitor");
  if (roleError) return roleError;

  const { searchParams } = request.nextUrl;
  const tokenInParam = searchParams.get("tokenIn");
  const tokenOutParam = searchParams.get("tokenOut");
  const amountInParam = searchParams.get("amountIn");

  if (!tokenInParam || !tokenOutParam || !amountInParam) {
    return NextResponse.json(
      { error: "Required query params: tokenIn, tokenOut, amountIn" },
      { status: 400 }
    );
  }

  const tokenIn = resolveToken(tokenInParam);
  const tokenOut = resolveToken(tokenOutParam);

  if (!tokenIn) {
    return NextResponse.json(
      { error: `Unknown tokenIn: ${tokenInParam}` },
      { status: 400 }
    );
  }
  if (!tokenOut) {
    return NextResponse.json(
      { error: `Unknown tokenOut: ${tokenOutParam}` },
      { status: 400 }
    );
  }

  let amountIn: bigint;
  try {
    amountIn = BigInt(amountInParam);
  } catch {
    return NextResponse.json(
      { error: "amountIn must be a valid BigInt string" },
      { status: 400 }
    );
  }

  logActivity(agent, "venues.query", {
    tokenIn: tokenIn.symbol,
    tokenOut: tokenOut.symbol,
  });

  // Check cache first
  const cacheKey = getCacheKey(
    tokenIn.address,
    tokenOut.address,
    amountInParam
  );
  const cached = getCachedResult(cacheKey);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "X-Cache": "HIT" },
    });
  }

  try {
    const result = await estimateVenues({
      tokenIn,
      tokenOut,
      amountIn,
    });

    // Serialize BigInt values for JSON
    const serialized = serializeBigInts(result);

    // Cache the result
    setCachedResult(cacheKey, serialized);

    return NextResponse.json(serialized, {
      headers: { "X-Cache": "MISS" },
    });
  } catch (err) {
    console.error("[agent/venues] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Venue estimation failed" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveToken(input: string): Token | undefined {
  if (!input) return undefined;
  if (input.startsWith("0x")) return getTokenByAddress(input);
  return getTokenBySymbol(input);
}

/**
 * Recursively convert BigInt values to strings for JSON serialization.
 */
function serializeBigInts(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "bigint") return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeBigInts);
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = serializeBigInts(value);
    }
    return result;
  }
  return obj;
}

export const dynamic = "force-dynamic";
