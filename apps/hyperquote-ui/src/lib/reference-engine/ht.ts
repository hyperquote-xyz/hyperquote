/**
 * HT.xyz R1 Aggregator Adapter
 *
 * Calls the Hypertrade R1 /quote endpoint (via server proxy) to get
 * aggregated DEX quotes across 7+ venues on HyperEVM.
 *
 * Uses includeHyperCore=false to keep HC and DEX contributions separated.
 */

import type { Token, AMMEstimate } from "@/types";
import { resolveSettlementToken } from "@/lib/native-wrap";

const DUMMY_RECEIVER = "0x0000000000000000000000000000000000000001";

const KNOWN_SYMBOLS: Record<string, string> = {
  "0xb88339cb7199b77e23db6e890353e22632ba630f": "USDC",
  "0x5555555555555555555555555555555555555555": "HYPE",  // WHYPE displayed as HYPE
  "0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb": "USD₮0",
  "0xfd739d4e423301ce9385c1fb8850539d657c296d": "kHYPE",
  "0x9b498c3c8a0b8cd8ba1d9851d40d186f1872b44e": "PURR",
  "0x000000000000780555bd0bca3791f89f9542c2d6": "KNTQ",
};

/**
 * Normalize a route for human display:
 * - Replace WHYPE with HYPE
 * - Remove consecutive duplicates
 * - Collapse meaningless intermediate hops
 */
function normalizeRoute(raw: string[]): string[] {
  // Replace WHYPE → HYPE everywhere
  const mapped = raw.map(s => s === "WHYPE" ? "HYPE" : s);
  // Remove consecutive duplicates (e.g. HYPE → HYPE)
  const deduped: string[] = [];
  for (const s of mapped) {
    if (deduped.length === 0 || deduped[deduped.length - 1] !== s) {
      deduped.push(s);
    }
  }
  return deduped.length >= 2 ? deduped : raw;
}

export interface HtVenueBreakdown {
  dex: string;
  portion: number;
  fee: number;
  poolAddress: string;
}

export interface HtQuoteResult {
  amountOut: bigint;
  amountOutHuman: number;
  route: string[];
  venues: HtVenueBreakdown[];
  hops: number;
  action: string;
  srcPrice: number;
  dstPrice: number;
}

/**
 * Fetch an aggregated DEX quote from HT R1 via server proxy.
 * Returns null on any failure (timeout, no route, API error).
 */
export async function fetchHtQuote(
  tokenIn: Token,
  tokenOut: Token,
  amountIn: bigint,
  signal?: AbortSignal,
): Promise<AMMEstimate | null> {
  const sellAddr = resolveSettlementToken(tokenIn).address;
  const buyAddr = resolveSettlementToken(tokenOut).address;

  const params = new URLSearchParams({
    src: sellAddr,
    dst: buyAddr,
    amount: amountIn.toString(),
    slippage: "0.3",
    receiver: DUMMY_RECEIVER,
    includeHyperCore: "false",
  });

  try {
    const res = await fetch(`/api/v1/bench/ht/quote?${params}`, { signal });
    if (!res.ok) return null;

    const json = await res.json();
    if (json.error || !json.toAmount) return null;

    const humanOut = parseFloat(json.toAmount);
    if (isNaN(humanOut) || humanOut <= 0) return null;

    const amountOut = BigInt(Math.floor(humanOut * 10 ** tokenOut.decimals));
    const normalizedIn = Number(amountIn) / 10 ** tokenIn.decimals;

    // Extract route symbols from protocols
    const route: string[] = [tokenIn.symbol];
    const venues: HtVenueBreakdown[] = [];

    if (json.protocols && Array.isArray(json.protocols)) {
      for (const hop of json.protocols) {
        for (const split of hop.splits ?? []) {
          venues.push({
            dex: split.dex ?? "unknown",
            portion: split.portion ?? 0,
            fee: split.fee ?? 0,
            poolAddress: split.poolAddress ?? "",
          });
        }
      }
      // Add intermediate/final symbols
      if (json.protocols.length > 1) {
        // Multi-hop: extract intermediate token symbol from srcToken/dstToken
        route.push("..."); // placeholder — full route parsing below
      }
    }
    route.push(tokenOut.symbol);

    // Build clean route from protocol hops
    const rawRoute = [tokenIn.symbol];
    if (json.protocols?.length > 1) {
      for (let i = 0; i < json.protocols.length - 1; i++) {
        const outAddr = json.protocols[i].outputTokenAddress?.toLowerCase();
        if (outAddr) {
          rawRoute.push(KNOWN_SYMBOLS[outAddr] ?? outAddr.slice(0, 10));
        }
      }
    }
    rawRoute.push(tokenOut.symbol);

    const displayRoute = normalizeRoute(rawRoute);

    return {
      source: "HT Aggregator",
      amountOut,
      priceImpact: 0,
      effectivePrice: normalizedIn > 0 ? humanOut / normalizedIn : undefined,
      poolLiquidity: 0n,
      route: displayRoute,
      isDirect: displayRoute.length <= 2,
      hops: json.protocols?.length ?? 1,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch detailed HT quote with venue breakdown (for modal display).
 */
export async function fetchHtQuoteDetailed(
  tokenIn: Token,
  tokenOut: Token,
  amountIn: bigint,
  signal?: AbortSignal,
): Promise<HtQuoteResult | null> {
  const sellAddr = resolveSettlementToken(tokenIn).address;
  const buyAddr = resolveSettlementToken(tokenOut).address;

  const params = new URLSearchParams({
    src: sellAddr,
    dst: buyAddr,
    amount: amountIn.toString(),
    slippage: "0.3",
    receiver: DUMMY_RECEIVER,
    includeHyperCore: "false",
  });

  try {
    const res = await fetch(`/api/v1/bench/ht/quote?${params}`, { signal });
    if (!res.ok) return null;

    const json = await res.json();
    if (json.error || !json.toAmount) return null;

    const humanOut = parseFloat(json.toAmount);
    if (isNaN(humanOut) || humanOut <= 0) return null;

    const venues: HtVenueBreakdown[] = [];
    const route = [tokenIn.symbol];

    for (const hop of json.protocols ?? []) {
      for (const split of hop.splits ?? []) {
        venues.push({
          dex: split.dex ?? "unknown",
          portion: split.portion ?? 0,
          fee: split.fee ?? 0,
          poolAddress: split.poolAddress ?? "",
        });
      }
    }

    if (json.protocols?.length > 1) {
      for (let i = 0; i < json.protocols.length - 1; i++) {
        const outAddr = json.protocols[i].outputTokenAddress?.toLowerCase();
        const knownSymbols: Record<string, string> = {
          "0xb88339cb7199b77e23db6e890353e22632ba630f": "USDC",
          "0x5555555555555555555555555555555555555555": "HYPE",
          "0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb": "USD₮0",
        };
        if (outAddr) route.push(knownSymbols[outAddr] ?? outAddr.slice(0, 10));
      }
    }
    route.push(tokenOut.symbol);

    return {
      amountOut: BigInt(Math.floor(humanOut * 10 ** tokenOut.decimals)),
      amountOutHuman: humanOut,
      route,
      venues,
      hops: json.protocols?.length ?? 1,
      action: json.action ?? "evm",
      srcPrice: parseFloat(json.srcToken?.price ?? "0"),
      dstPrice: parseFloat(json.dstToken?.price ?? "0"),
    };
  } catch {
    return null;
  }
}
