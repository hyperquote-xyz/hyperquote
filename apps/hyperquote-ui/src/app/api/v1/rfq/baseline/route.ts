/**
 * RFQ Baseline Persistence API
 *
 * POST /api/v1/rfq/baseline — Persist the AMM baseline captured at RFQ submission.
 *
 * The frontend sends the SOR quote data that was already displayed to the user
 * at the time they submitted the RFQ. This avoids re-fetching — we use the
 * exact baseline the user saw.
 *
 * Body:
 *   rfqId                   — Client-generated RFQ ID
 *   tokenIn                 — Input token address
 *   tokenOut                — Output token address
 *   amountIn                — Raw BigInt string
 *   baselineAmountOut       — Raw BigInt string from SOR quote
 *   baselineEffectivePrice  — Float from SOR summary
 *   baselinePriceImpactBps  — Int from SOR summary
 *   baselineBlockNumber     — String from SOR meta.asOfBlock
 *   baselineTimestamp        — ISO string from SOR meta.timestamp
 *   baselineRouteSummary    — Array of { protocol, poolType, fractionPct }
 *
 * Returns: { success: true, id } or { error }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

interface BaselineBody {
  rfqId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  baselineAmountOut: string;
  baselineEffectivePrice: number;
  baselinePriceImpactBps: number;
  baselineBlockNumber: string;
  baselineTimestamp: string;
  baselineRouteSummary: { protocol: string; poolType: string; fractionPct: string }[];
}

export async function POST(request: NextRequest) {
  let body: BaselineBody;

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
    !body.tokenIn ||
    !body.tokenOut ||
    !body.amountIn ||
    !body.baselineAmountOut ||
    body.baselineEffectivePrice == null ||
    body.baselinePriceImpactBps == null ||
    !body.baselineBlockNumber ||
    !body.baselineTimestamp
  ) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  // Validate addresses
  if (
    !/^0x[0-9a-fA-F]{40}$/.test(body.tokenIn) ||
    !/^0x[0-9a-fA-F]{40}$/.test(body.tokenOut)
  ) {
    return NextResponse.json(
      { error: "Invalid token address format" },
      { status: 400 }
    );
  }

  // Validate BigInt strings
  try {
    BigInt(body.amountIn);
    BigInt(body.baselineAmountOut);
  } catch {
    return NextResponse.json(
      { error: "amountIn and baselineAmountOut must be valid BigInt strings" },
      { status: 400 }
    );
  }

  try {
    // Upsert — idempotent if called multiple times for the same rfqId
    const baseline = await prisma.rfqBaseline.upsert({
      where: { rfqId: body.rfqId },
      create: {
        rfqId: body.rfqId,
        tokenIn: body.tokenIn.toLowerCase(),
        tokenOut: body.tokenOut.toLowerCase(),
        amountIn: body.amountIn,
        baselineAmountOut: body.baselineAmountOut,
        baselineEffectivePrice: body.baselineEffectivePrice,
        baselinePriceImpactBps: body.baselinePriceImpactBps,
        baselineBlockNumber: body.baselineBlockNumber,
        baselineTimestamp: body.baselineTimestamp,
        baselineRouteSummary: JSON.stringify(body.baselineRouteSummary ?? []),
      },
      update: {
        // Overwrite if re-submitted (edge case: user re-creates same RFQ)
        baselineAmountOut: body.baselineAmountOut,
        baselineEffectivePrice: body.baselineEffectivePrice,
        baselinePriceImpactBps: body.baselinePriceImpactBps,
        baselineBlockNumber: body.baselineBlockNumber,
        baselineTimestamp: body.baselineTimestamp,
        baselineRouteSummary: JSON.stringify(body.baselineRouteSummary ?? []),
      },
    });

    return NextResponse.json({ success: true, id: baseline.id });
  } catch (err) {
    console.error("[rfq/baseline] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
