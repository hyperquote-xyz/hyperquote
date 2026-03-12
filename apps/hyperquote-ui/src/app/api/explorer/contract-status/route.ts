import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/explorer/contract-status?address=0x...
 *
 * Proxies Etherscan v2 "getabi" for HyperEVM (chainId from env).
 * Returns { address, verified, abiAvailable, fetchedAt, error? }
 *
 * Uses a 60-second in-memory cache keyed by lowercase address.
 */

interface CachedResult {
  address: string;
  verified: boolean;
  abiAvailable: boolean;
  fetchedAt: number;
  error?: string;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CachedResult>();

const EXPLORER_API_KEY = process.env.EXPLORER_API_KEY ?? "";
const EXPLORER_CHAIN_ID = process.env.EXPLORER_CHAIN_ID ?? "999";
const EXPLORER_API_BASE =
  process.env.EXPLORER_API_BASE ?? "https://api.etherscan.io/v2/api";

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");

  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json(
      { error: "Invalid or missing address parameter" },
      { status: 400 }
    );
  }

  const key = address.toLowerCase();
  const now = Date.now();

  // Check cache
  const cached = cache.get(key);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json(cached);
  }

  // Build Etherscan v2 request
  const url = new URL(EXPLORER_API_BASE);
  url.searchParams.set("chainid", EXPLORER_CHAIN_ID);
  url.searchParams.set("module", "contract");
  url.searchParams.set("action", "getabi");
  url.searchParams.set("address", address);
  if (EXPLORER_API_KEY) {
    url.searchParams.set("apikey", EXPLORER_API_KEY);
  }

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      // Next.js edge: no-store to avoid caching upstream
      cache: "no-store",
    });

    if (!res.ok) {
      const result: CachedResult = {
        address: key,
        verified: false,
        abiAvailable: false,
        fetchedAt: now,
        error: `Explorer API returned HTTP ${res.status}`,
      };
      cache.set(key, result);
      return NextResponse.json(result);
    }

    const data = await res.json();

    // Etherscan v2 responses:
    //   Verified:       { status: "1", result: "<ABI JSON>" }
    //   Not verified:   { status: "0", result: "Contract source code not verified" }
    //   Rate-limited:   { status: "0", result: "Max rate limit reached" } (or similar)
    //   Invalid addr:   { status: "0", result: "Invalid Address format" }
    const resultStr = typeof data.result === "string" ? data.result : "";
    const isDefinitiveNotVerified =
      data.status === "0" && resultStr === "Contract source code not verified";
    const isVerified =
      data.status === "1" &&
      resultStr.length > 0 &&
      resultStr !== "Contract source code not verified";

    // If status is "0" but NOT the definitive "not verified" message,
    // treat as an error (rate limit, invalid address, etc.)
    const isApiError =
      data.status === "0" && !isDefinitiveNotVerified;

    let abiAvailable = false;
    if (isVerified) {
      try {
        JSON.parse(data.result);
        abiAvailable = true;
      } catch {
        abiAvailable = false;
      }
    }

    const result: CachedResult = {
      address: key,
      verified: isVerified,
      abiAvailable,
      fetchedAt: now,
      ...(isApiError ? { error: `Explorer API: ${resultStr || "unknown error"}` } : {}),
    };

    // Don't cache errors — allow retry on next request
    if (!isApiError) {
      cache.set(key, result);
    }
    return NextResponse.json(result);
  } catch (err) {
    const result: CachedResult = {
      address: key,
      verified: false,
      abiAvailable: false,
      fetchedAt: now,
      error: err instanceof Error ? err.message : "Unknown fetch error",
    };
    cache.set(key, result);
    return NextResponse.json(result);
  }
}
