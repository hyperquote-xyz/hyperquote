/**
 * HyperBloom Aggregator Benchmark — Conditional Info-only Price Quote
 *
 * GET /api/v1/bench/hyperbloom/price?sellToken=0x...&buyToken=0x...&sellAmount=1000000
 *
 * Conditional server-side proxy for HyperBloom's pricing API.
 * - If HYPERBLOOM_API_KEY is set → calls their API and normalizes the response
 * - If not set → returns { enabled: false } immediately
 *
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

interface HyperBloomBenchResponse {
  source: "hyperbloom";
  enabled: boolean;
  outputAmount: string | null;
  route: BenchRouteSplit[];
  computeTimeMs: number;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const HYPERBLOOM_BASE_URL = "https://api.hyperbloom.xyz";
const HYPERBLOOM_TIMEOUT_MS = 5_000;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<NextResponse<HyperBloomBenchResponse>> {
  const startTime = Date.now();

  // ── Check for API key ──
  const apiKey = process.env.HYPERBLOOM_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      source: "hyperbloom" as const,
      enabled: false,
      outputAmount: null,
      route: [],
      computeTimeMs: Date.now() - startTime,
      error: "API key not configured",
    });
  }

  const url = new URL(request.url);
  const sellToken = url.searchParams.get("sellToken");
  const buyToken = url.searchParams.get("buyToken");
  const sellAmount = url.searchParams.get("sellAmount");

  // ── Validate required params ──
  if (!sellToken || !buyToken || !sellAmount) {
    return NextResponse.json(
      {
        source: "hyperbloom" as const,
        enabled: true,
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
        source: "hyperbloom" as const,
        enabled: true,
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
        source: "hyperbloom" as const,
        enabled: true,
        outputAmount: null,
        route: [],
        computeTimeMs: Date.now() - startTime,
        error: "Invalid sellAmount. Expected BigInt string.",
      },
      { status: 400 }
    );
  }

  // ── Call HyperBloom API ──
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HYPERBLOOM_TIMEOUT_MS);

    const params = new URLSearchParams({
      sellToken,
      buyToken,
      sellAmount,
    });

    const res = await fetch(`${HYPERBLOOM_BASE_URL}/swap/v1/price?${params}`, {
      headers: {
        "x-api-key": apiKey,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `HyperBloom API returned HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();

    // ── Normalize response ──
    // Response shape mapped from standard aggregator patterns.
    // Handles both `buyAmount`/`outputAmount` and `sources`/`route` field names.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const route: BenchRouteSplit[] = (data.sources ?? data.route ?? []).map((s: any) => ({
      dex: String(s.name ?? s.dex ?? "unknown"),
      portion: Number(s.proportion ?? s.portion ?? 0),
      poolAddress: String(s.poolAddress ?? s.pool ?? ""),
      fee: Number(s.fee ?? 0),
    }));

    return NextResponse.json({
      source: "hyperbloom" as const,
      enabled: true,
      outputAmount:
        data.buyAmount != null
          ? String(data.buyAmount)
          : data.outputAmount != null
            ? String(data.outputAmount)
            : null,
      route,
      computeTimeMs: Date.now() - startTime,
      error: null,
    });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? "HyperBloom request timed out (5s)"
          : err.message
        : "HyperBloom benchmark failed";

    console.warn("[bench/hyperbloom] Error:", message);

    // Return 200 with error field — client treats this as informational
    return NextResponse.json({
      source: "hyperbloom" as const,
      enabled: true,
      outputAmount: null,
      route: [],
      computeTimeMs: Date.now() - startTime,
      error: message,
    });
  }
}
