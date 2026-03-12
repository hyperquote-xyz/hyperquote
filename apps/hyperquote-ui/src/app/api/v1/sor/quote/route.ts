/**
 * SOR Quote API — Phase 9
 *
 * GET /api/v1/sor/quote?tokenIn=...&tokenOut=...&amountIn=...
 *
 * Main entry point for the Smart Order Router.
 * Runs the full pipeline: route generation → evaluation → split → explain.
 *
 * Query params:
 *   tokenIn     — Input token address (required)
 *   tokenOut    — Output token address (required)
 *   amountIn    — Raw input amount as BigInt string (required)
 *   maxHops     — Maximum hop count, 1 or 2 (default: 2)
 *   maxRoutes   — Maximum routes to return (default: 5)
 *   maxSplit    — Maximum routes to split across (default: 4)
 *   slugs       — Comma-separated protocol slugs to limit to
 *   explain     — "true" for full explainability (default: true)
 *
 * Response:
 *   Full ExplainedQuote (Phase 8) with route trace, alternatives,
 *   as-of block, warnings, fees, and split info.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeAddress } from "@/lib/router/address";
import { publicClient } from "@/lib/router/client";
import { findBestRoutes } from "@/lib/router/route";
import { optimiseSplit } from "@/lib/router/split";
import { buildExplainedQuote } from "@/lib/router/explain";
import { validateQuote } from "@/lib/router/safety";

// Serialiser for BigInt
function serialise(obj: unknown): unknown {
  return JSON.parse(
    JSON.stringify(obj, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value
    )
  );
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const { searchParams } = new URL(request.url);

  // ── Parse params ──
  const tokenInRaw = searchParams.get("tokenIn");
  const tokenOutRaw = searchParams.get("tokenOut");
  const amountInRaw = searchParams.get("amountIn");
  const maxHops = parseInt(searchParams.get("maxHops") ?? "2", 10);
  const maxRoutes = parseInt(searchParams.get("maxRoutes") ?? "5", 10);
  const maxSplit = parseInt(searchParams.get("maxSplit") ?? "4", 10);
  const slugsParam = searchParams.get("slugs");
  const slugs = slugsParam ? slugsParam.split(",").map((s) => s.trim()) : undefined;

  // ── Validation ──
  if (!tokenInRaw || !tokenOutRaw || !amountInRaw) {
    return NextResponse.json(
      {
        error: "Missing required params: tokenIn, tokenOut, amountIn",
        usage:
          "GET /api/v1/sor/quote?tokenIn=0x...&tokenOut=0x...&amountIn=1000000",
      },
      { status: 400 }
    );
  }

  let tokenIn: string;
  let tokenOut: string;
  try {
    tokenIn = normalizeAddress(tokenInRaw);
    tokenOut = normalizeAddress(tokenOutRaw);
  } catch {
    return NextResponse.json(
      { error: "Invalid token address format" },
      { status: 400 }
    );
  }

  if (tokenIn === tokenOut) {
    return NextResponse.json(
      { error: "tokenIn and tokenOut must be different" },
      { status: 400 }
    );
  }

  let amountIn: string;
  try {
    const parsed = BigInt(amountInRaw);
    if (parsed <= 0n) throw new Error("Must be positive");
    amountIn = parsed.toString();
  } catch {
    return NextResponse.json(
      { error: "amountIn must be a positive integer (raw units)" },
      { status: 400 }
    );
  }

  try {
    // ── Look up token metadata ──
    const [tokenInInfo, tokenOutInfo] = await Promise.all([
      prisma.token.findUnique({
        where: { address: tokenIn },
        select: { symbol: true, decimals: true },
      }),
      prisma.token.findUnique({
        where: { address: tokenOut },
        select: { symbol: true, decimals: true },
      }),
    ]);

    if (!tokenInInfo) {
      return NextResponse.json(
        { error: `Token ${tokenIn} not found in registry` },
        { status: 404 }
      );
    }
    if (!tokenOutInfo) {
      return NextResponse.json(
        { error: `Token ${tokenOut} not found in registry` },
        { status: 404 }
      );
    }

    // ── Get current block ──
    const currentBlock = await publicClient.getBlockNumber();

    // ── Phase 6: Generate + evaluate routes ──
    const allRoutes = await findBestRoutes(tokenIn, tokenOut, amountIn, {
      maxHops,
      maxRoutes,
      maxCandidates: 30,
      slugs,
    });

    if (allRoutes.length === 0) {
      const computeTimeMs = Date.now() - startTime;
      return NextResponse.json(
        serialise({
          meta: {
            timestamp: new Date().toISOString(),
            asOfBlock: currentBlock.toString(),
            computeTimeMs,
            candidatesConsidered: 0,
            viableRoutes: 0,
            isSplit: false,
          },
          summary: {
            tokenIn,
            tokenInSymbol: tokenInInfo.symbol,
            tokenOut,
            tokenOutSymbol: tokenOutInfo.symbol,
            amountIn,
            amountOut: "0",
          },
          routes: [],
          alternatives: [],
          warnings: [
            "No viable routes found. Pools may not have state data yet — try POST /api/v1/sor/pool-state/refresh first.",
          ],
          fees: [],
        })
      );
    }

    // ── Phase 7: Split optimisation ──
    const candidates = allRoutes.map((r) => r.route);
    const splitResult = optimiseSplit(candidates, amountIn, {
      maxSplitRoutes: maxSplit,
    });

    // ── Phase 8: Build explained quote ──
    const computeTimeMs = Date.now() - startTime;
    const explained = buildExplainedQuote({
      tokenIn,
      tokenInSymbol: tokenInInfo.symbol,
      tokenInDecimals: tokenInInfo.decimals,
      tokenOut,
      tokenOutSymbol: tokenOutInfo.symbol,
      tokenOutDecimals: tokenOutInfo.decimals,
      amountIn,
      asOfBlock: currentBlock,
      computeTimeMs,
      splitResult,
      allEvaluatedRoutes: allRoutes,
    });

    // ── Phase 10: Safety validation ──
    const validated = validateQuote(explained, currentBlock);

    return NextResponse.json(serialise(validated));
  } catch (err) {
    console.error("[sor/quote] Error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Internal error",
        meta: {
          computeTimeMs: Date.now() - startTime,
        },
      },
      { status: 500 }
    );
  }
}
