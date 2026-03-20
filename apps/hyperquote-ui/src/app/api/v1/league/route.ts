/**
 * League API
 *
 * GET /api/v1/league?role=maker|taker&period=7d|30d|all&minUsd=number
 *
 * Returns ranked league entries sourced from FeedFill records.
 * League score is computed using the formulas in src/lib/league.ts.
 * Performance metrics only — no badge boosts or points.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  aggregateForLeague,
  makerLeagueScore,
  takerLeagueScore,
  type FillRow,
} from "@/lib/league";

// ---------------------------------------------------------------------------
// Param parsers
// ---------------------------------------------------------------------------

type Role = "maker" | "taker";
type Period = "7d" | "30d" | "all";

function parseRole(v: string | null): Role {
  if (v === "taker") return "taker";
  return "maker";
}

function parsePeriod(v: string | null): Period {
  if (v === "30d") return "30d";
  if (v === "all") return "all";
  return "7d";
}

function parseMinUsd(v: string | null): number {
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function periodToDate(period: Period): Date | null {
  if (period === "all") return null;
  const now = new Date();
  const days = period === "30d" ? 30 : 7;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const role = parseRole(searchParams.get("role"));
  const period = parsePeriod(searchParams.get("period"));
  const minUsd = parseMinUsd(searchParams.get("minUsd"));
  const search = searchParams.get("search")?.toLowerCase() ?? null;
  const limit = 100;

  try {
    const since = periodToDate(period);

    // Build where clause
    const where: Record<string, unknown> = {};
    if (since) {
      where.filledAt = { gte: since };
    }
    if (minUsd > 0) {
      where.notionalUsd = { gte: minUsd };
    }

    // Fetch FeedFill rows
    const feedFills = await prisma.feedFill.findMany({
      where,
      select: {
        maker: true,
        taker: true,
        notionalUsd: true,
        improvementBps: true,
        isPrivate: true,
        benchmarkAvailable: true,
      },
    });

    // Filter out rows with null notional
    const rows: FillRow[] = feedFills
      .filter((f) => f.notionalUsd != null && f.notionalUsd > 0)
      .map((f) => ({
        maker: f.maker,
        taker: f.taker,
        notionalUsd: f.notionalUsd!,
        improvementBps: f.improvementBps ?? 0,
        isPrivate: f.isPrivate,
        benchmarkAvailable: f.benchmarkAvailable,
      }));

    // Aggregate by address with repeat-decay
    const aggregated = aggregateForLeague(rows, role);

    // For makers, compute cancel rate from FeedRfq
    const cancelRates = new Map<string, number>();
    if (role === "maker") {
      const makerAddrs = [...aggregated.keys()];
      if (makerAddrs.length > 0) {
        // Get all FeedRfqs where the maker was the taker (created the RFQ)
        // and count KILLED vs total — this gives cancel/kill rate
        const rfqWhere: Record<string, unknown> = {};
        if (since) {
          rfqWhere.createdAt = { gte: since };
        }

        // For each maker, we need their fill count and kill count
        // from FeedRfq perspective: makers can also be tracked via fills
        // But the spec says: "reliabilityFactor = clamp(1.1 − cancelRate × 1.5, 0.5, 1.1)"
        // cancelRate comes from FeedRfq where maker had RFQs with status KILLED
        // In the FeedRfq model, the "taker" is the requester, not the maker.
        // Kill rate for makers = RFQs where their quote was killed / total RFQs they quoted
        // Since we don't have per-maker quote tracking in FeedRfq, we'll default to 0 for now
        // This can be enhanced when per-maker quote tracking is added
        for (const addr of makerAddrs) {
          cancelRates.set(addr, 0);
        }
      }
    }

    // Compute league scores and build entries (no badge/boost — league is performance only)
    const entries: LeagueEntry[] = [];

    for (const [addr, agg] of aggregated) {
      const cancelRate = cancelRates.get(addr) ?? 0;
      const input = { ...agg, cancelRate };

      const result = role === "maker"
        ? makerLeagueScore(input)
        : takerLeagueScore(input);

      entries.push({
        rank: 0, // assigned after sort
        address: addr,
        score: Math.round(result.score * 100) / 100,
        rawScore: result.score,
        filledNotional: Math.round(agg.rawNotional * 100) / 100,
        avgImprovementBps: agg.avgImprovementBps,
        privateShare: Math.round(agg.privateShare * 10000) / 10000,
        fills: agg.fills,
        reliability: role === "maker" ? result.factors.reliability : null,
        cancelRate: role === "maker" ? cancelRate : null,
        boostMultiplier: 1.0,
        points: 0,
      });
    }

    // Sort by score descending
    entries.sort((a, b) => b.score - a.score);

    // Apply search filter
    let filtered = entries;
    if (search && search.length >= 4) {
      filtered = entries.filter((e) => e.address.includes(search));
    }

    // Assign ranks (on the full list, not filtered)
    entries.forEach((e, i) => {
      e.rank = i + 1;
    });

    // Limit
    const page = filtered.slice(0, limit);

    // KPI aggregation
    const totalNotional = rows.reduce((sum, r) => sum + r.notionalUsd, 0);
    const totalFills = rows.length;
    const withBenchmark = rows.filter((r) => r.benchmarkAvailable);
    const avgImprovement = withBenchmark.length > 0
      ? Math.round(withBenchmark.reduce((s, r) => s + r.improvementBps, 0) / withBenchmark.length)
      : 0;
    const privateFills = rows.filter((r) => r.isPrivate).length;
    const privateVolumePct = totalFills > 0
      ? Math.round((privateFills / totalFills) * 10000) / 100
      : 0;

    return NextResponse.json({
      role,
      period,
      minUsd,
      entries: page,
      totalParticipants: entries.length,
      hasMore: filtered.length > limit,
      kpi: {
        totalNotional: Math.round(totalNotional * 100) / 100,
        avgImprovementBps: avgImprovement,
        privateVolumePct,
        fillCount: totalFills,
      },
    });
  } catch (err) {
    console.error("[league] Error (returning empty):", err);
    // Return valid empty response instead of 500 — UI renders empty state
    return NextResponse.json({
      role,
      period,
      minUsd,
      entries: [],
      totalParticipants: 0,
      hasMore: false,
      kpi: {
        totalNotional: 0,
        avgImprovementBps: 0,
        privateVolumePct: 0,
        fillCount: 0,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

interface LeagueEntry {
  rank: number;
  address: string;
  score: number;
  rawScore: number;
  filledNotional: number;
  avgImprovementBps: number;
  privateShare: number;
  fills: number;
  reliability: number | null;
  cancelRate: number | null;
  boostMultiplier: number;
  points: number;
}
