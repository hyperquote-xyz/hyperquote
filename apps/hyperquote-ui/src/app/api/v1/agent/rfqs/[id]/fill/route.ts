/**
 * POST /api/v1/agent/rfqs/[id]/fill — Mark an RFQ as filled (role: taker)
 *
 * Body:
 *   txHash      — On-chain transaction hash (0x + 64 hex chars)
 *   maker       — Maker wallet address
 *   amountIn    — Raw BigInt string
 *   amountOut   — Raw BigInt string
 *   amountInUsd — USD value of input amount (float)
 *
 * Security:
 *   - Only the agent that created the RFQ (matching wallet) can fill it
 *   - Falls back to Prisma FeedRfq ownership check if RFQ expired from memory
 *
 * Does three things:
 *   1. Marks RFQ as FILLED in registry + Prisma (status + SSE events)
 *   2. Records Fill + FeedFill with points computation (same as /api/v1/fills)
 *   3. Logs activity
 */

import { NextRequest, NextResponse } from "next/server";
import {
  authenticateAgent,
  requireRole,
  logActivity,
  getClientIp,
} from "@/lib/agentAuth";
import { markRfqFilled, getRFQOwner, getRFQById } from "@/lib/rfqRegistry";
import { prisma } from "@/lib/db";
import { computePoints } from "@/lib/points";
import { resolveVerifiedNotionalUsd, logNotionalAudit } from "@/lib/notional";

interface FillBody {
  txHash: string;
  maker: string;
  amountIn: string;
  amountOut: string;
  amountInUsd: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { agent, error } = await authenticateAgent(request);
  if (error) return error;

  const roleError = requireRole(agent, "taker");
  if (roleError) return roleError;

  const { id } = await params;

  let body: FillBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // ── Validate fields ──

  if (!body.txHash || !/^0x[0-9a-fA-F]{64}$/.test(body.txHash)) {
    return NextResponse.json(
      { error: "Missing or invalid txHash (expected 0x + 64 hex chars)" },
      { status: 400 }
    );
  }

  if (!body.maker || !/^0x[0-9a-fA-F]{40}$/.test(body.maker)) {
    return NextResponse.json(
      { error: "Missing or invalid maker address" },
      { status: 400 }
    );
  }

  if (!body.amountIn || !body.amountOut) {
    return NextResponse.json(
      { error: "Missing amountIn or amountOut (BigInt strings)" },
      { status: 400 }
    );
  }

  // NOTE: body.amountInUsd is accepted for backwards-compat but IGNORED.
  // USD notional is always derived server-side below.

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

  // ── Ownership check ──
  // Verify the calling agent owns this RFQ (agent.wallet === RFQ taker)

  let rfqOwner = await getRFQOwner(id);

  if (!rfqOwner) {
    // RFQ may have expired from memory — check Prisma
    try {
      const feedRfq = await prisma.feedRfq.findUnique({ where: { id } });
      if (feedRfq) {
        rfqOwner = feedRfq.taker;
      }
    } catch {
      // DB may be unavailable
    }
  }

  if (!rfqOwner) {
    return NextResponse.json(
      { error: "RFQ not found" },
      { status: 404 }
    );
  }

  if (rfqOwner.toLowerCase() !== agent.wallet.toLowerCase()) {
    return NextResponse.json(
      {
        error: "Forbidden: only the taker that created this RFQ can fill it",
        rfqOwner,
        agentWallet: agent.wallet,
      },
      { status: 403 }
    );
  }

  // ── Get token addresses from RFQ ──

  let tokenIn = "";
  let tokenOut = "";
  let visibility: "public" | "private" = "public";

  // Try in-memory first
  const live = await getRFQById(id);
  if (live) {
    tokenIn = live.rfq.tokenIn.address.toLowerCase();
    tokenOut = live.rfq.tokenOut.address.toLowerCase();
    visibility = live.rfq.visibility ?? "public";
  } else {
    // Fall back to Prisma
    try {
      const feedRfq = await prisma.feedRfq.findUnique({ where: { id } });
      if (feedRfq) {
        tokenIn = feedRfq.tokenIn;
        tokenOut = feedRfq.tokenOut;
        visibility = (feedRfq.visibility as "public" | "private") ?? "public";
      }
    } catch {
      // Use empty strings — fill recording still works
    }
  }

  // ── 1. Mark RFQ as filled (status + SSE events + Telegram) ──

  await markRfqFilled(id, body.txHash);

  // ── 2. Record fill with points computation ──

  const takerAddr = agent.wallet.toLowerCase();
  const makerAddr = body.maker.toLowerCase();
  const isPrivate = visibility === "private";

  try {
    // Look up baseline (if available)
    let baselineOut: bigint | null = null;
    let baselineOutStr: string | null = null;

    try {
      const baseline = await prisma.rfqBaseline.findUnique({
        where: { rfqId: id },
      });
      if (baseline) {
        baselineOut = BigInt(baseline.baselineAmountOut);
        baselineOutStr = baseline.baselineAmountOut;
      }
    } catch {
      // Baseline lookup non-critical
    }

    // Compute improvement: ((rfqOut / baselineOut) - 1) * 10000 bps
    const benchmarkAvailable = baselineOut != null && baselineOut > 0n;
    const improvementBps = benchmarkAvailable
      ? Math.round(
          (parseFloat(amountOut.toString()) /
            parseFloat(baselineOut!.toString()) -
            1) *
            10000
        )
      : 0;

    // ── Server-side USD notional (client amountInUsd is NEVER used) ──────────
    const notional = await resolveVerifiedNotionalUsd({
      rfqId: id,
      tokenInAddr: tokenIn,
      tokenOutAddr: tokenOut,
      amountInRaw: body.amountIn,
      amountOutRaw: body.amountOut,
    });
    logNotionalAudit("agent/fill", id, body.txHash, notional);
    const verifiedUsd = notional.usd;
    const usdForPoints = verifiedUsd ?? 0;

    // Compute points using v2 engine — driven by verified notional only.
    const takerResult = computePoints({
      role: "taker",
      notionalUsd: usdForPoints,
      improvementBps,
      benchmarkAvailable,
      isPrivate,
      maker: makerAddr,
      taker: takerAddr,
    });

    const makerResult = computePoints({
      role: "maker",
      notionalUsd: usdForPoints,
      improvementBps,
      benchmarkAvailable,
      isPrivate,
      maker: makerAddr,
      taker: takerAddr,
    });

    // Create Fill + FeedFill records (verified USD written to legacy + audit cols)
    const [fill] = await Promise.all([
      prisma.fill.create({
        data: {
          txHash: body.txHash.toLowerCase(),
          rfqId: id,
          taker: takerAddr,
          maker: makerAddr,
          tokenIn: tokenIn || "0x",
          tokenOut: tokenOut || "0x",
          amountIn: body.amountIn,
          amountOut: body.amountOut,
          amountInUsd: usdForPoints,
          verifiedNotionalUsd: verifiedUsd,
          pricingSource: notional.source,
          pricingTimestamp: notional.timestamp,
          baselineOut: baselineOutStr,
          improvementBps,
          takerPoints: takerResult.points,
          makerPoints: makerResult.points,
        },
      }),
      prisma.feedFill
        .create({
          data: {
            rfqId: id,
            txHash: body.txHash.toLowerCase(),
            maker: makerAddr,
            taker: takerAddr,
            tokenIn: tokenIn || "0x",
            tokenOut: tokenOut || "0x",
            amountIn: body.amountIn,
            amountOut: body.amountOut,
            notionalUsd: verifiedUsd && verifiedUsd > 0 ? verifiedUsd : null,
            verifiedNotionalUsd: verifiedUsd,
            pricingSource: notional.source,
            pricingTimestamp: notional.timestamp,
            isPrivate,
            benchmarkSource: benchmarkAvailable ? "sor" : null,
            benchmarkOut: baselineOutStr,
            improvementBps: benchmarkAvailable ? improvementBps : null,
            benchmarkAvailable,
          },
        })
        .catch((err) => {
          console.warn("[agent/fill] FeedFill persist failed:", err);
          return null;
        }),
    ]);

    logActivity(agent, "rfq.fill", {
      rfqId: id,
      txHash: body.txHash,
      takerPoints: takerResult.points,
      makerPoints: makerResult.points,
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({
      success: true,
      rfqId: id,
      txHash: body.txHash,
      fill: {
        id: fill.id,
        improvementBps: fill.improvementBps,
        takerPoints: fill.takerPoints,
        makerPoints: fill.makerPoints,
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
    console.error("[agent/fill] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
