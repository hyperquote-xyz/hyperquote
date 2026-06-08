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
import { verifyFillTransaction, allowUnverifiedFills } from "@/lib/onchainFill";

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

  // txHash and amountInUsd are always required.
  if (!body.txHash || !/^0x[0-9a-fA-F]{64}$/.test(body.txHash)) {
    return NextResponse.json(
      { error: "Missing or invalid txHash (expected 0x + 64 hex chars)" },
      { status: 400 }
    );
  }
  if (body.amountInUsd == null) {
    return NextResponse.json(
      { error: "Missing required field: amountInUsd" },
      { status: 400 }
    );
  }

  // ── Resolve TRUSTED fill values ──────────────────────────────────────────
  // In production we derive maker/taker/tokens/amounts from the on-chain
  // QuoteFilled event so a client cannot spoof a fill or inflate amounts.
  let makerAddr: string;
  let takerAddr: string;
  let tokenInAddr: string;
  let tokenOutAddr: string;
  let amountInStr: string;
  let amountOutStr: string;
  let amountOut: bigint;

  if (allowUnverifiedFills()) {
    // Local-dev simulation path only (never active in production).
    console.warn("[fills] ALLOW_UNVERIFIED_FILLS active — trusting client values (dev only)");
    if (!body.taker || !body.maker || !body.tokenIn || !body.tokenOut || !body.amountIn || !body.amountOut) {
      return NextResponse.json({ error: "Missing fill fields (dev mode)" }, { status: 400 });
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(body.taker) || !/^0x[0-9a-fA-F]{40}$/.test(body.maker)) {
      return NextResponse.json({ error: "Invalid taker or maker address format" }, { status: 400 });
    }
    try {
      BigInt(body.amountIn);
      amountOut = BigInt(body.amountOut);
    } catch {
      return NextResponse.json({ error: "amountIn and amountOut must be valid BigInt strings" }, { status: 400 });
    }
    makerAddr = body.maker.toLowerCase();
    takerAddr = body.taker.toLowerCase();
    tokenInAddr = body.tokenIn.toLowerCase();
    tokenOutAddr = body.tokenOut.toLowerCase();
    amountInStr = body.amountIn;
    amountOutStr = body.amountOut;
  } else {
    // Production: require a verified on-chain QuoteFilled event.
    const verified = await verifyFillTransaction(body.txHash);
    if (!verified) {
      return NextResponse.json(
        { error: "Forbidden: txHash does not contain a valid QuoteFilled event from the RFQ contract." },
        { status: 403 }
      );
    }
    makerAddr = verified.maker;
    takerAddr = verified.taker;
    tokenInAddr = verified.tokenIn;
    tokenOutAddr = verified.tokenOut;
    amountInStr = verified.amountIn.toString();
    amountOutStr = verified.amountOut.toString();
    amountOut = verified.amountOut;
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
          tokenIn: tokenInAddr,
          tokenOut: tokenOutAddr,
          amountIn: amountInStr,
          amountOut: amountOutStr,
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
          tokenIn: tokenInAddr,
          tokenOut: tokenOutAddr,
          amountIn: amountInStr,
          amountOut: amountOutStr,
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
