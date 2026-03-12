/**
 * RFQ Performance Summary API
 *
 * GET /api/v1/rfq/performance-summary?timeframe=7d
 *
 * Returns aggregate performance metrics:
 *   - avg_improvement_bps      — Average maker improvement over AMM baseline (bps)
 *   - median_improvement_bps   — Median improvement (bps)
 *   - percent_rfqs_beating_baseline — % of filled RFQs where maker > baseline
 *   - total_rfqs               — Total number of RFQs with baselines
 *   - total_with_performance   — Total RFQs that have performance records
 *   - total_fills              — Number of actual fills (won=true)
 *
 * Query params:
 *   timeframe — "7d" | "30d" | "all" (default: "all")
 *   tokenIn   — (optional) filter by input token
 *   tokenOut  — (optional) filter by output token
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

type Timeframe = "7d" | "30d" | "all";

function parseTimeframe(raw: string | null): Timeframe {
  if (raw === "7d" || raw === "30d") return raw;
  return "all";
}

function timeframeToDate(tf: Timeframe): Date | null {
  if (tf === "all") return null;
  const now = Date.now();
  const daysMs = tf === "7d" ? 7 * 86400_000 : 30 * 86400_000;
  return new Date(now - daysMs);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const timeframe = parseTimeframe(searchParams.get("timeframe"));
  const tokenIn = searchParams.get("tokenIn")?.toLowerCase();
  const tokenOut = searchParams.get("tokenOut")?.toLowerCase();
  const sinceDate = timeframeToDate(timeframe);

  try {
    // Build baseline filter
    const baselineWhere: Record<string, unknown> = {};
    if (sinceDate) {
      baselineWhere.createdAt = { gte: sinceDate };
    }
    if (tokenIn) {
      baselineWhere.tokenIn = tokenIn;
    }
    if (tokenOut) {
      baselineWhere.tokenOut = tokenOut;
    }

    // Total RFQs (with baselines in timeframe)
    const totalRfqs = await prisma.rfqBaseline.count({
      where: baselineWhere,
    });

    // Get all performance records for matching baselines
    const performanceRecords = await prisma.rfqPerformance.findMany({
      where: {
        baseline: baselineWhere,
      },
      select: {
        deltaVsBaselinePct: true,
        won: true,
      },
    });

    const totalWithPerformance = new Set(
      await prisma.rfqPerformance.findMany({
        where: { baseline: baselineWhere },
        select: { rfqId: true },
        distinct: ["rfqId"],
      }).then((rows) => rows.map((r) => r.rfqId))
    ).size;

    // Filter to won records only for fill-based metrics
    const fills = performanceRecords.filter((r) => r.won);
    const totalFills = fills.length;

    // Calculate improvement metrics (in bps, from the pct field * 100)
    const allImprovementsBps = fills.map((r) =>
      Math.round(r.deltaVsBaselinePct * 100)
    );

    // Average improvement
    const avgImprovementBps =
      allImprovementsBps.length > 0
        ? Math.round(
            allImprovementsBps.reduce((a, b) => a + b, 0) /
              allImprovementsBps.length
          )
        : 0;

    // Median improvement
    const medianImprovementBps = computeMedian(allImprovementsBps);

    // % of fills that beat baseline
    const fillsBeatBaseline = fills.filter((r) => r.deltaVsBaselinePct > 0).length;
    const percentBeatBaseline =
      totalFills > 0
        ? Math.round((fillsBeatBaseline / totalFills) * 10000) / 100
        : 0;

    // Also compute stats for ALL quotes (not just winning ones)
    const allQuoteImprovementsBps = performanceRecords.map((r) =>
      Math.round(r.deltaVsBaselinePct * 100)
    );
    const avgAllQuotesBps =
      allQuoteImprovementsBps.length > 0
        ? Math.round(
            allQuoteImprovementsBps.reduce((a, b) => a + b, 0) /
              allQuoteImprovementsBps.length
          )
        : 0;

    return NextResponse.json({
      timeframe,
      totalRfqs,
      totalWithPerformance,
      totalFills,

      // Fill-based metrics (won=true quotes only)
      fills: {
        avgImprovementBps,
        medianImprovementBps,
        percentBeatBaseline,
        count: totalFills,
      },

      // All-quote metrics (every maker quote submitted, win or lose)
      allQuotes: {
        avgImprovementBps: avgAllQuotesBps,
        medianImprovementBps: computeMedian(allQuoteImprovementsBps),
        count: performanceRecords.length,
      },
    });
  } catch (err) {
    console.error("[rfq/performance-summary] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

/**
 * Compute the median of a sorted array of numbers.
 * Returns 0 for empty arrays.
 */
function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}
