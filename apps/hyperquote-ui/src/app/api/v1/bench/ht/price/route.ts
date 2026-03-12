/**
 * HT.xyz Aggregator Benchmark — Info-only Price Quote
 *
 * GET /api/v1/bench/ht/price?sellToken=0x...&buyToken=0x...&sellAmount=1000000
 *
 * Server-side proxy to HT.xyz POST /getSwapInfo.
 * Returns normalized output amount + route breakdown.
 *
 * This endpoint is informational only — we ignore the transaction data.
 * Returns HTTP 200 even on upstream failure (error field populated).
 * Only returns 400 for our own input validation failures.
 */

import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BenchRouteSplit {
  dex: string;
  portion: number;
  poolAddress: string;
  fee: number;
}

interface HTBenchResponse {
  source: "ht.xyz";
  outputAmount: string | null;
  route: BenchRouteSplit[];
  computeTimeMs: number;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const HT_BASE_URL = "https://core.ht.xyz/api/v1/trade";
const HT_TIMEOUT_MS = 5_000;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<NextResponse<HTBenchResponse>> {
  const startTime = Date.now();

  const url = new URL(request.url);
  const sellToken = url.searchParams.get("sellToken");
  const buyToken = url.searchParams.get("buyToken");
  const sellAmount = url.searchParams.get("sellAmount");

  // ── Validate required params ──
  if (!sellToken || !buyToken || !sellAmount) {
    return NextResponse.json(
      {
        source: "ht.xyz" as const,
        outputAmount: null,
        route: [],
        computeTimeMs: Date.now() - startTime,
        error: "Missing required params: sellToken, buyToken, sellAmount",
      },
      { status: 400 }
    );
  }

  if (!ADDRESS_RE.test(sellToken) || !ADDRESS_RE.test(buyToken)) {
    return NextResponse.json(
      {
        source: "ht.xyz" as const,
        outputAmount: null,
        route: [],
        computeTimeMs: Date.now() - startTime,
        error: "Invalid address format. Expected 0x + 40 hex chars.",
      },
      { status: 400 }
    );
  }

  try {
    BigInt(sellAmount);
  } catch {
    return NextResponse.json(
      {
        source: "ht.xyz" as const,
        outputAmount: null,
        route: [],
        computeTimeMs: Date.now() - startTime,
        error: "Invalid sellAmount. Expected BigInt string.",
      },
      { status: 400 }
    );
  }

  // ── Call HT.xyz API ──
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HT_TIMEOUT_MS);

    const res = await fetch(`${HT_BASE_URL}/getSwapInfo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inputAmount: sellAmount,
        slippage: 0.3,
        inputTokenAddress: sellToken,
        outputTokenAddress: buyToken,
        feeAddress: "0x0000000000000000000000000000000000000000",
        feeBps: 0,
        enableHyperCore: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `HT API returned HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json();

    // core.ht.xyz wraps response in { body: { ... }, statusCode: 200 }
    const data = json.body ?? json;

    // ── Normalize routeEvm[].splits[] → flat route array ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const route: BenchRouteSplit[] = (data.route ?? data.routeEvm ?? []).flatMap((leg: any) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (leg.splits ?? []).map((split: any) => ({
        dex: String(split.dex ?? "unknown"),
        portion: Number(split.portion ?? 0),
        poolAddress: String(split.poolAddress ?? ""),
        fee: Number(split.fee ?? 0),
      }))
    );

    return NextResponse.json({
      source: "ht.xyz" as const,
      outputAmount: data.outputAmount != null ? String(data.outputAmount) : null,
      route,
      computeTimeMs: Date.now() - startTime,
      error: null,
    });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? "HT.xyz request timed out (5s)"
          : err.message
        : "HT.xyz benchmark failed";

    console.warn("[bench/ht] Error:", message);

    // Return 200 with error field — client treats this as informational
    return NextResponse.json({
      source: "ht.xyz" as const,
      outputAmount: null,
      route: [],
      computeTimeMs: Date.now() - startTime,
      error: message,
    });
  }
}
