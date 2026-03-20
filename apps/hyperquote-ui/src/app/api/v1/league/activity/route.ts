/**
 * League Activity API — drawer endpoint.
 *
 * GET /api/v1/league/activity?role=maker|taker&address=0x...&period=7d|30d|all&limit=10
 *
 * Returns the most recent fills for a given address (as maker or taker),
 * used by the league detail drawer.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

type Role = "maker" | "taker";
type Period = "7d" | "30d" | "all";

function parseRole(v: string | null): Role {
  return v === "taker" ? "taker" : "maker";
}

function parsePeriod(v: string | null): Period {
  if (v === "30d") return "30d";
  if (v === "all") return "all";
  return "7d";
}

function periodToDate(period: Period): Date | null {
  if (period === "all") return null;
  const now = new Date();
  const days = period === "30d" ? 30 : 7;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const role = parseRole(searchParams.get("role"));
  const address = searchParams.get("address")?.toLowerCase();
  const period = parsePeriod(searchParams.get("period"));
  const limitParam = searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitParam ?? "10", 10) || 10, 1), 50);

  if (!address || !/^0x[0-9a-f]{40}$/.test(address)) {
    return NextResponse.json(
      { error: "Valid address parameter required" },
      { status: 400 }
    );
  }

  try {
    const since = periodToDate(period);

    const where: Record<string, unknown> = {
      [role]: address,
    };
    if (since) {
      where.filledAt = { gte: since };
    }

    const fills = await prisma.feedFill.findMany({
      where,
      orderBy: { filledAt: "desc" },
      take: limit,
      select: {
        txHash: true,
        filledAt: true,
        maker: true,
        taker: true,
        tokenIn: true,
        tokenOut: true,
        amountIn: true,
        amountOut: true,
        notionalUsd: true,
        isPrivate: true,
        improvementBps: true,
        benchmarkAvailable: true,
      },
    });

    return NextResponse.json({
      address,
      role,
      period,
      fills: fills.map((f) => ({
        txHash: f.txHash,
        filledAt: f.filledAt.toISOString(),
        counterparty: role === "maker" ? f.taker : f.maker,
        tokenIn: f.tokenIn,
        tokenOut: f.tokenOut,
        amountIn: f.amountIn,
        amountOut: f.amountOut,
        notionalUsd: f.notionalUsd,
        isPrivate: f.isPrivate,
        improvementBps: f.improvementBps,
        benchmarkAvailable: f.benchmarkAvailable,
      })),
    });
  } catch (err) {
    console.error("[league/activity] Error (returning empty):", err);
    // Return valid empty response instead of 500 — UI renders empty state
    return NextResponse.json({
      address,
      role,
      period,
      fills: [],
    });
  }
}
