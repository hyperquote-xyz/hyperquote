/**
 * Fill Recording API
 *
 * POST /api/v1/fills — Record a completed RFQ fill and compute points.
 *
 * Called after a successful on-chain fill execution.
 * Looks up the AMM baseline (if available) and computes improvement + points
 * using the v2 hardened points engine.
 *
 * Also persists a FeedFill record for league aggregation.
 *
 * Body:
 *   txHash       — On-chain transaction hash (unique)
 *   rfqId        — RFQ ID (optional, used to look up baseline)
 *   taker        — Taker wallet address
 *   maker        — Maker wallet address
 *   tokenIn      — Input token address
 *   tokenOut     — Output token address
 *   amountIn     — Raw BigInt string
 *   amountOut    — Raw BigInt string
 *   amountInUsd  — USD value of input amount (float)
 *   visibility   — "public" | "private" (optional, default "public")
 *
 * Returns: { success: true, fill } or { error }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { computePoints } from "@/lib/points";

interface FillBody {
  txHash: string;
  rfqId?: string | null;
  taker: string;
  maker: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  amountInUsd: number;
  visibility?: "public" | "private";
}

export async function POST(request: NextRequest) {
  let body: FillBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // Validate required fields
  if (
    !body.txHash ||
    !body.taker ||
    !body.maker ||
    !body.tokenIn ||
    !body.tokenOut ||
    !body.amountIn ||
    !body.amountOut ||
    body.amountInUsd == null
  ) {
    return NextResponse.json(
      { error: "Missing required fields: txHash, taker, maker, tokenIn, tokenOut, amountIn, amountOut, amountInUsd" },
      { status: 400 }
    );
  }

  // Validate addresses
  if (!/^0x[0-9a-fA-F]{40}$/.test(body.taker) || !/^0x[0-9a-fA-F]{40}$/.test(body.maker)) {
    return NextResponse.json(
      { error: "Invalid taker or maker address format" },
      { status: 400 }
    );
  }

  // Validate BigInt strings
  let amountOut: bigint;
  try {
    BigInt(body.amountIn);
    amountOut = BigInt(body.amountOut);
  } catch {
    return NextResponse.json(
      { error: "amountIn and amountOut must be valid BigInt strings" },
      { status: 400 }
    );
  }

  try {
    // Look up baseline (if rfqId provided)
    let baselineOut: bigint | null = null;
    let baselineOutStr: string | null = null;

    if (body.rfqId) {
      const baseline = await prisma.rfqBaseline.findUnique({
        where: { rfqId: body.rfqId },
      });
      if (baseline) {
        baselineOut = BigInt(baseline.baselineAmountOut);
        baselineOutStr = baseline.baselineAmountOut;
      }
    }

    // Compute improvement: ((rfqOut / baselineOut) - 1) * 10000 bps
    const benchmarkAvailable = baselineOut != null && baselineOut > 0n;
    const improvementBps = benchmarkAvailable
      ? Math.round((parseFloat(amountOut.toString()) / parseFloat(baselineOut!.toString()) - 1) * 10000)
      : 0;

    const amountInUsd = body.amountInUsd;
    const makerAddr = body.maker.toLowerCase();
    const takerAddr = body.taker.toLowerCase();
    const isPrivate = body.visibility === "private";

    // Compute points using v2 engine (no NFT boost at record time)
    const takerResult = computePoints({
      role: "taker",
      notionalUsd: amountInUsd,
      improvementBps,
      benchmarkAvailable,
      isPrivate,
      maker: makerAddr,
      taker: takerAddr,
    });

    const makerResult = computePoints({
      role: "maker",
      notionalUsd: amountInUsd,
      improvementBps,
      benchmarkAvailable,
      isPrivate,
      maker: makerAddr,
      taker: takerAddr,
    });

    // Create Fill record + FeedFill record in parallel
    const [fill] = await Promise.all([
      prisma.fill.create({
        data: {
          txHash: body.txHash.toLowerCase(),
          rfqId: body.rfqId ?? null,
          taker: takerAddr,
          maker: makerAddr,
          tokenIn: body.tokenIn.toLowerCase(),
          tokenOut: body.tokenOut.toLowerCase(),
          amountIn: body.amountIn,
          amountOut: body.amountOut,
          amountInUsd,
          baselineOut: baselineOutStr,
          improvementBps,
          takerPoints: takerResult.points,
          makerPoints: makerResult.points,
        },
      }),
      prisma.feedFill.create({
        data: {
          rfqId: body.rfqId ?? null,
          txHash: body.txHash.toLowerCase(),
          maker: makerAddr,
          taker: takerAddr,
          tokenIn: body.tokenIn.toLowerCase(),
          tokenOut: body.tokenOut.toLowerCase(),
          amountIn: body.amountIn,
          amountOut: body.amountOut,
          notionalUsd: amountInUsd > 0 ? amountInUsd : null,
          isPrivate,
          benchmarkSource: benchmarkAvailable ? "sor" : null,
          benchmarkOut: baselineOutStr,
          improvementBps: benchmarkAvailable ? improvementBps : null,
          benchmarkAvailable,
        },
      }).catch((err) => {
        // FeedFill is best-effort — don't fail the fill recording
        console.warn("[fills] FeedFill persist failed:", err);
        return null;
      }),
    ]);

    return NextResponse.json({
      success: true,
      fill: {
        id: fill.id,
        txHash: fill.txHash,
        improvementBps: fill.improvementBps,
        takerPoints: fill.takerPoints,
        makerPoints: fill.makerPoints,
        version: takerResult.version,
      },
    });
  } catch (err) {
    // Handle duplicate txHash
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "Fill already recorded for this transaction" },
        { status: 409 }
      );
    }
    console.error("[fills] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
