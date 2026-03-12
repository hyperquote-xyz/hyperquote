import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side proxy for Hyperliquid L2 orderbook.
 *
 * Avoids CORS issues when the browser calls the HL API directly.
 * GET /api/hyperliquid/orderbook?coin=HYPE&nSigFigs=3
 *
 * Optional `nSigFigs` (2-5) aggregates levels to N significant figures,
 * giving deeper effective depth within the 20-level REST cap.
 *
 * Returns the raw HL l2Book response (asks + bids) or an error.
 */

const HL_API = "https://api.hyperliquid.xyz/info";
const TIMEOUT_MS = 5_000;

export async function GET(req: NextRequest) {
  const coin = req.nextUrl.searchParams.get("coin");
  if (!coin || coin.length > 20) {
    return NextResponse.json(
      { error: "Missing or invalid 'coin' query parameter" },
      { status: 400 }
    );
  }

  // Optional: aggregate levels to N significant figures (2, 3, 4, 5)
  const nSigFigsRaw = req.nextUrl.searchParams.get("nSigFigs");
  let nSigFigs: number | undefined;
  if (nSigFigsRaw !== null) {
    const parsed = parseInt(nSigFigsRaw, 10);
    if (![2, 3, 4, 5].includes(parsed)) {
      return NextResponse.json(
        { error: "nSigFigs must be 2, 3, 4, or 5" },
        { status: 400 }
      );
    }
    nSigFigs = parsed;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const hlBody: Record<string, unknown> = { type: "l2Book", coin };
    if (nSigFigs !== undefined) hlBody.nSigFigs = nSigFigs;

    const response = await fetch(HL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(hlBody),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      return NextResponse.json(
        { error: `HL API returned ${response.status}` },
        { status: 502 }
      );
    }

    const data = await response.json();

    // Validate response shape
    const levels = data?.levels;
    if (
      !levels ||
      !Array.isArray(levels) ||
      levels.length < 2 ||
      !Array.isArray(levels[0]) ||
      !Array.isArray(levels[1])
    ) {
      return NextResponse.json(
        { error: "Invalid orderbook data from HL API", coin },
        { status: 502 }
      );
    }

    // HL l2Book: levels[0] = bids (buy orders, best/highest first),
    //            levels[1] = asks (sell orders, best/lowest first).
    const bids = levels[0].map((l: { px: string; sz: string; n: number }) => ({
      px: l.px,
      sz: l.sz,
    }));
    const asks = levels[1].map((l: { px: string; sz: string; n: number }) => ({
      px: l.px,
      sz: l.sz,
    }));

    return NextResponse.json(
      { coin, asks, bids, timestamp: Date.now() },
      {
        headers: {
          "Cache-Control": "public, max-age=2, stale-while-revalidate=5",
        },
      }
    );
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown error";
    console.error(`[api/hyperliquid/orderbook] ${coin}: ${message}`);
    return NextResponse.json(
      { error: "Failed to fetch orderbook", detail: message },
      { status: 502 }
    );
  }
}
