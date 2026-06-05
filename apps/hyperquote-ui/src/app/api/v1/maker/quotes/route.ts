/**
 * GET /api/v1/maker/quotes?wallet=0x...
 *
 * Returns all quotes submitted by a maker, with RFQ status.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get("wallet")?.toLowerCase();

  if (!wallet || !/^0x[0-9a-f]{40}$/.test(wallet)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  try {
    const quotes = await prisma.feedQuote.findMany({
      where: { maker: wallet },
      include: { feedRfq: { select: { status: true, fillTxHash: true, tokenIn: true, tokenOut: true, tokenInJson: true, tokenOutJson: true, amountIn: true, expiry: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const items = quotes.map((q) => ({
      id: q.id,
      rfqId: q.rfqId,
      maker: q.maker,
      kind: q.kind,
      amountIn: q.amountIn,
      amountOut: q.amountOut,
      expiry: q.expiry,
      signature: q.signature,
      createdAt: q.createdAt,
      rfqStatus: q.feedRfq?.status ?? "UNKNOWN",
      rfqFillTxHash: q.feedRfq?.fillTxHash ?? null,
      tokenIn: safeParseJson(q.feedRfq?.tokenInJson ?? ""),
      tokenOut: safeParseJson(q.feedRfq?.tokenOutJson ?? ""),
    }));

    return NextResponse.json({ items });
  } catch (err) {
    console.error("[maker/quotes] Error:", err);
    return NextResponse.json({ error: "Failed to fetch quotes" }, { status: 500 });
  }
}

function safeParseJson(json: string) {
  try { return JSON.parse(json); } catch { return null; }
}
