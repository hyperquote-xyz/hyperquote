/**
 * POST /api/v1/admin/backfill-notional — Backfill verified USD notional.
 *
 * Recomputes verifiedNotionalUsd (server-side) for existing Fill / FeedFill
 * rows that predate USD verification, repopulates the legacy amountInUsd /
 * notionalUsd columns with the verified value, recomputes points, and records
 * the pricing source/timestamp audit trail.
 *
 * Admin-gated. Re-runnable and batched.
 *
 * Body (optional): { limit?: number }   (default 200, max 1000)
 *
 * Returns: { processed, updated, bySource, remaining }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/adminAuth";
import { resolveVerifiedNotionalUsd, logNotionalAudit } from "@/lib/notional";
import { computePoints } from "@/lib/points";

export async function POST(request: NextRequest) {
  const auth = requireAdmin(request);
  if (!auth.ok) return auth.response;

  let limit = 200;
  try {
    const body = await request.json();
    if (typeof body?.limit === "number") limit = Math.min(Math.max(1, body.limit), 1000);
  } catch {
    /* no body — use default */
  }

  const bySource: Record<string, number> = {};
  let processed = 0;
  let updated = 0;

  // ── Backfill Fill rows ────────────────────────────────────────────────────
  const fills = await prisma.fill.findMany({
    where: { verifiedNotionalUsd: null },
    take: limit,
    orderBy: { timestamp: "asc" },
  });

  for (const f of fills) {
    processed++;
    const notional = await resolveVerifiedNotionalUsd({
      rfqId: f.rfqId,
      tokenInAddr: f.tokenIn,
      tokenOutAddr: f.tokenOut,
      amountInRaw: f.amountIn,
      amountOutRaw: f.amountOut,
    });
    logNotionalAudit("backfill/fill", f.rfqId, f.txHash, notional);
    bySource[notional.source] = (bySource[notional.source] ?? 0) + 1;

    const verifiedUsd = notional.usd;
    const usdForPoints = verifiedUsd ?? 0;

    // Recompute points from verified notional. isPrivate is taken from the
    // matching FeedFill when available (Fill itself doesn't store it).
    const feed = await prisma.feedFill.findUnique({ where: { txHash: f.txHash } });
    const isPrivate = feed?.isPrivate ?? false;
    const benchmarkAvailable = f.baselineOut != null && f.baselineOut !== "";

    const takerResult = computePoints({
      role: "taker", notionalUsd: usdForPoints, improvementBps: f.improvementBps,
      benchmarkAvailable, isPrivate, maker: f.maker, taker: f.taker,
    });
    const makerResult = computePoints({
      role: "maker", notionalUsd: usdForPoints, improvementBps: f.improvementBps,
      benchmarkAvailable, isPrivate, maker: f.maker, taker: f.taker,
    });

    await prisma.fill.update({
      where: { id: f.id },
      data: {
        amountInUsd: usdForPoints,
        verifiedNotionalUsd: verifiedUsd,
        pricingSource: notional.source,
        pricingTimestamp: notional.timestamp,
        takerPoints: takerResult.points,
        makerPoints: makerResult.points,
      },
    });
    updated++;

    // Mirror onto the matching FeedFill (maker stats / league source).
    if (feed) {
      await prisma.feedFill.update({
        where: { id: feed.id },
        data: {
          notionalUsd: verifiedUsd && verifiedUsd > 0 ? verifiedUsd : null,
          verifiedNotionalUsd: verifiedUsd,
          pricingSource: notional.source,
          pricingTimestamp: notional.timestamp,
        },
      });
    }
  }

  // ── Backfill orphan FeedFill rows (no matching Fill) ──────────────────────
  const orphanFeedFills = await prisma.feedFill.findMany({
    where: { verifiedNotionalUsd: null },
    take: limit,
    orderBy: { filledAt: "asc" },
  });

  for (const ff of orphanFeedFills) {
    if (!ff.amountIn || !ff.amountOut) continue;
    processed++;
    const notional = await resolveVerifiedNotionalUsd({
      rfqId: ff.rfqId,
      tokenInAddr: ff.tokenIn,
      tokenOutAddr: ff.tokenOut,
      amountInRaw: ff.amountIn,
      amountOutRaw: ff.amountOut,
    });
    logNotionalAudit("backfill/feedfill", ff.rfqId, ff.txHash, notional);
    bySource[notional.source] = (bySource[notional.source] ?? 0) + 1;

    await prisma.feedFill.update({
      where: { id: ff.id },
      data: {
        notionalUsd: notional.usd && notional.usd > 0 ? notional.usd : null,
        verifiedNotionalUsd: notional.usd,
        pricingSource: notional.source,
        pricingTimestamp: notional.timestamp,
      },
    });
    updated++;
  }

  const remaining = await prisma.fill.count({ where: { verifiedNotionalUsd: null } });

  return NextResponse.json({ processed, updated, bySource, remaining });
}
