/**
 * RFQ Performance Recording API
 *
 * POST /api/v1/rfq/performance — Record maker quote vs baseline comparison.
 *
 * Called when a maker quote is accepted (filled) or when the RFQ resolves.
 * Computes delta vs baseline and persists the performance record.
 *
 * Body:
 *   rfqId           — RFQ ID (must have a baseline already persisted)
 *   makerId         — Maker wallet address
 *   makerAmountOut  — Raw BigInt string (what maker offered)
 *   won             — Boolean (true if this quote was actually filled on-chain)
 *
 * Returns: { success: true, record } or { error }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

interface PerformanceBody {
  rfqId: string;
  makerId: string;
  makerAmountOut: string;
  won: boolean;
}

export async function POST(request: NextRequest) {
  let body: PerformanceBody;

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
    !body.rfqId ||
    !body.makerId ||
    !body.makerAmountOut ||
    body.won == null
  ) {
    return NextResponse.json(
      { error: "Missing required fields: rfqId, makerId, makerAmountOut, won" },
      { status: 400 }
    );
  }

  // Validate maker address
  if (!/^0x[0-9a-fA-F]{40}$/.test(body.makerId)) {
    return NextResponse.json(
      { error: "Invalid maker address format" },
      { status: 400 }
    );
  }

  // Validate BigInt string
  let makerOut: bigint;
  try {
    makerOut = BigInt(body.makerAmountOut);
  } catch {
    return NextResponse.json(
      { error: "makerAmountOut must be a valid BigInt string" },
      { status: 400 }
    );
  }

  try {
    // Fetch baseline for this RFQ
    const baseline = await prisma.rfqBaseline.findUnique({
      where: { rfqId: body.rfqId },
    });

    if (!baseline) {
      return NextResponse.json(
        { error: `No baseline found for rfqId: ${body.rfqId}. Persist baseline first via POST /api/v1/rfq/baseline.` },
        { status: 404 }
      );
    }

    // Compute delta vs baseline
    const baselineOut = BigInt(baseline.baselineAmountOut);
    const deltaAbs = makerOut - baselineOut; // positive = maker beat baseline
    const deltaAbsStr = deltaAbs.toString();

    // Percentage: (makerOut - baselineOut) / baselineOut * 100
    let deltaPct = 0;
    if (baselineOut > 0n) {
      deltaPct = Number(deltaAbs) / Number(baselineOut) * 100;
    }

    // Create performance record
    const record = await prisma.rfqPerformance.create({
      data: {
        rfqId: body.rfqId,
        makerId: body.makerId.toLowerCase(),
        makerAmountOut: body.makerAmountOut,
        deltaVsBaselineAbs: deltaAbsStr,
        deltaVsBaselinePct: deltaPct,
        won: body.won,
      },
    });

    return NextResponse.json({
      success: true,
      record: {
        id: record.id,
        rfqId: record.rfqId,
        makerId: record.makerId,
        makerAmountOut: record.makerAmountOut,
        deltaVsBaselineAbs: record.deltaVsBaselineAbs,
        deltaVsBaselinePct: record.deltaVsBaselinePct,
        won: record.won,
      },
    });
  } catch (err) {
    console.error("[rfq/performance] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
