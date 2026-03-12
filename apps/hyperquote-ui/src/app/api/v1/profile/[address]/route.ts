/**
 * Profile API
 *
 * GET /api/v1/profile/[address]
 *
 * Returns maker and taker stats for a given wallet address across 7d and 30d.
 * Also computes a tier badge based on 30d maker points:
 *   Bronze: < 10,000
 *   Silver: < 100,000
 *   Gold:   >= 100,000
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

interface PeriodStats {
  points: number;
  volume: number;
  fills: number;
  avgImprovementBps: number;
}

function computeStats(
  fills: { takerPoints: number; makerPoints: number; amountInUsd: number; improvementBps: number }[],
  role: "maker" | "taker"
): PeriodStats {
  if (fills.length === 0) {
    return { points: 0, volume: 0, fills: 0, avgImprovementBps: 0 };
  }

  const totalPoints = fills.reduce(
    (sum, f) => sum + (role === "maker" ? f.makerPoints : f.takerPoints),
    0
  );
  const totalVolume = fills.reduce((sum, f) => sum + f.amountInUsd, 0);
  const totalImprovement = fills.reduce((sum, f) => sum + f.improvementBps, 0);

  return {
    points: Math.round(totalPoints),
    volume: Math.round(totalVolume * 100) / 100,
    fills: fills.length,
    avgImprovementBps: Math.round(totalImprovement / fills.length),
  };
}

function computeTier(makerPoints30d: number): "bronze" | "silver" | "gold" {
  if (makerPoints30d >= 100_000) return "gold";
  if (makerPoints30d >= 10_000) return "silver";
  return "bronze";
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address: rawAddress } = await params;

  if (!rawAddress || !/^0x[0-9a-fA-F]{40}$/.test(rawAddress)) {
    return NextResponse.json(
      { error: "Invalid address format" },
      { status: 400 }
    );
  }

  const address = rawAddress.toLowerCase();
  const now = Date.now();
  const since7d = new Date(now - 7 * 86400_000);
  const since30d = new Date(now - 30 * 86400_000);

  try {
    // Fetch fills where address is maker (30d covers 7d)
    const makerFills30d = await prisma.fill.findMany({
      where: { maker: address, timestamp: { gte: since30d } },
      select: { takerPoints: true, makerPoints: true, amountInUsd: true, improvementBps: true, timestamp: true },
    });

    const makerFills7d = makerFills30d.filter((f: { timestamp: Date }) => f.timestamp >= since7d);

    // Fetch fills where address is taker (30d covers 7d)
    const takerFills30d = await prisma.fill.findMany({
      where: { taker: address, timestamp: { gte: since30d } },
      select: { takerPoints: true, makerPoints: true, amountInUsd: true, improvementBps: true, timestamp: true },
    });

    const takerFills7d = takerFills30d.filter((f: { timestamp: Date }) => f.timestamp >= since7d);

    const maker7d = computeStats(makerFills7d, "maker");
    const maker30d = computeStats(makerFills30d, "maker");
    const taker7d = computeStats(takerFills7d, "taker");
    const taker30d = computeStats(takerFills30d, "taker");

    const tier = computeTier(maker30d.points);

    return NextResponse.json({
      address,
      tier,
      maker7d,
      maker30d,
      taker7d,
      taker30d,
    });
  } catch (err) {
    console.error("[profile] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
