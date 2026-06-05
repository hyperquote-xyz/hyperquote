/**
 * GET /api/v1/maker/stats?wallet=0x...
 *
 * Returns aggregated maker statistics from the database.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get("wallet")?.toLowerCase();

  if (!wallet || !/^0x[0-9a-f]{40}$/.test(wallet)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  try {
    // Count quotes sent
    const quotesSent = await prisma.feedQuote.count({ where: { maker: wallet } });

    // Count quotes won (RFQ filled where this maker's quote was accepted)
    const quotesWon = await prisma.feedFill.count({ where: { maker: wallet } });

    // Volume quoted (sum of amountIn from quotes, using correct token decimals)
    const quotedVolume = await prisma.feedQuote.findMany({
      where: { maker: wallet },
      select: { amountIn: true, feedRfq: { select: { tokenInJson: true } } },
    });
    const volumeQuoted = quotedVolume.reduce((sum, q) => {
      try {
        let decimals = 18; // safe default for most tokens (HYPE, KNTQ, etc.)
        try {
          const tokenMeta = JSON.parse(q.feedRfq.tokenInJson);
          if (typeof tokenMeta.decimals === "number") decimals = tokenMeta.decimals;
        } catch { /* fall back to 18 */ }
        return sum + Number(BigInt(q.amountIn)) / 10 ** decimals;
      } catch { return sum; }
    }, 0);

    // Volume filled
    const fills = await prisma.feedFill.findMany({
      where: { maker: wallet },
      select: { notionalUsd: true },
    });
    const volumeFilled = fills.reduce((sum, f) => sum + (f.notionalUsd ?? 0), 0);

    // Hit rate
    const hitRate = quotesSent > 0 ? ((quotesWon / quotesSent) * 100).toFixed(1) + "%" : "—";

    return NextResponse.json({
      quotesSent,
      quotesWon,
      volumeQuoted: Math.round(volumeQuoted),
      volumeFilled: Math.round(volumeFilled),
      hitRate,
    });
  } catch (err) {
    console.error("[maker/stats] Error:", err);
    return NextResponse.json({
      quotesSent: 0, quotesWon: 0, volumeQuoted: 0, volumeFilled: 0, hitRate: "—",
    });
  }
}
