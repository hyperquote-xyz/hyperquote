/**
 * Leaderboard API
 *
 * GET /api/v1/leaderboard?tab=makers|takers&window=7d|30d|all&cursor=0x...
 *
 * Returns ranked list of addresses by points within the time window.
 * Points include NFT badge boosts applied at query time.
 * Maker entries include kill/cancel rate.
 */

import { NextRequest, NextResponse } from "next/server";
import { buildLeaderboard, parseTab, parseWindow } from "@/lib/leaderboard";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tab = parseTab(searchParams.get("tab") ?? searchParams.get("role"));
  const window = parseWindow(searchParams.get("window"));
  const cursor = searchParams.get("cursor") ?? undefined;
  const limit = 100;

  try {
    const result = await buildLeaderboard(tab, window, { limit: limit + 1, cursor });

    // Check if there are more entries beyond the limit
    const hasMore = result.entries.length > limit;
    const entries = result.entries.slice(0, limit);

    return NextResponse.json({
      tab,
      window,
      entries,
      totalParticipants: result.totalParticipants,
      hasMore,
    });
  } catch (err) {
    console.error("[leaderboard] Error (returning empty):", err);
    // Return valid empty response instead of 500 — UI renders empty state
    return NextResponse.json({
      tab,
      window,
      entries: [],
      totalParticipants: 0,
      hasMore: false,
    });
  }
}
