/**
 * GET /api/v1/badges/:address
 *
 * Returns NFT badge ownership and boost multiplier for a wallet address.
 * Uses ERC-721 balanceOf via the shared HyperEVM viem client.
 *
 * Response: { hasHypio, hasHypurr, boostMultiplier }
 *
 * Results are cached in-memory for 10 minutes (best-effort).
 */

import { NextRequest, NextResponse } from "next/server";
import { getAddress, type Address } from "viem";
import { publicClient } from "@/lib/router/client";
import { NFT_BADGES, computeBoost, type BadgeResult } from "@/lib/badges";

// ---------------------------------------------------------------------------
// In-memory cache: checksummed address → { result, expiresAt }
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_CONTROL =
  "public, max-age=600, s-maxage=600, stale-while-revalidate=600";

interface CacheEntry {
  result: BadgeResult;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

// Periodically prune stale entries (every 5 min)
let pruneStarted = false;
function startPruner() {
  if (pruneStarted) return;
  pruneStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(key);
    }
  }, 5 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// ERC-721 balanceOf ABI fragment
// ---------------------------------------------------------------------------

const erc721BalanceOfAbi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const;

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;

  // Validate address format
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json(
      { error: "Invalid address" },
      { status: 400 }
    );
  }

  // Normalize to checksum address — consistent cache key regardless of input casing
  const normalized = getAddress(address);

  // Check cache
  const cached = cache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.result, {
      headers: { "Cache-Control": CACHE_CONTROL },
    });
  }

  try {
    startPruner();

    // Parallel balanceOf calls via shared HyperEVM client
    const [hypioBalance, hypurrBalance] = await Promise.all([
      publicClient.readContract({
        address: NFT_BADGES.hypio.contract as Address,
        abi: erc721BalanceOfAbi,
        functionName: "balanceOf",
        args: [normalized as Address],
      }).catch(() => 0n),
      publicClient.readContract({
        address: NFT_BADGES.hypurr.contract as Address,
        abi: erc721BalanceOfAbi,
        functionName: "balanceOf",
        args: [normalized as Address],
      }).catch(() => 0n),
    ]);

    const hasHypio = BigInt(hypioBalance) > 0n;
    const hasHypurr = BigInt(hypurrBalance) > 0n;
    const boostMultiplier = computeBoost(hasHypio, hasHypurr);

    const result: BadgeResult = { hasHypio, hasHypurr, boostMultiplier };

    // Store in cache (best-effort — serverless may evict)
    cache.set(normalized, { result, expiresAt: Date.now() + CACHE_TTL_MS });

    return NextResponse.json(result, {
      headers: { "Cache-Control": CACHE_CONTROL },
    });
  } catch (err) {
    console.error("[badges] RPC error:", err);
    // On failure, return safe default — never break the UI
    const fallback: BadgeResult = {
      hasHypio: false,
      hasHypurr: false,
      boostMultiplier: 1.0,
    };
    return NextResponse.json(fallback, { status: 200 });
  }
}
