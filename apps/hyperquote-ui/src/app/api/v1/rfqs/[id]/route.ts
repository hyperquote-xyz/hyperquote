/**
 * GET /api/v1/rfqs/[id] — Get RFQ details by ID.
 *
 * Tries in-memory registry first (has live quotes attached),
 * falls back to Prisma (persistent, for expired/filled RFQs).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getRFQById } from "@/lib/rfqRegistry";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Try in-memory first (has live quotes)
  const live = getRFQById(id);
  if (live) {
    return NextResponse.json({
      rfq: live.rfq,
      quotes: live.quotes,
      status: "OPEN",
      quoteCount: live.quotes.length,
    });
  }

  // Fall back to Prisma
  try {
    const record = await prisma.feedRfq.findUnique({ where: { id } });
    if (!record) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      rfq: {
        id: record.id,
        taker: record.taker,
        tokenIn: safeParseJson(record.tokenInJson),
        tokenOut: safeParseJson(record.tokenOutJson),
        kind: record.kind,
        amountIn: record.amountIn,
        amountOut: record.amountOut,
        expiry: record.expiry,
        createdAt: record.createdAt,
        visibility: record.visibility,
      },
      status: record.status,
      quoteCount: record.quoteCount,
      fillTxHash: record.fillTxHash,
    });
  } catch (err) {
    console.error("[rfqs/:id] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

function safeParseJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
