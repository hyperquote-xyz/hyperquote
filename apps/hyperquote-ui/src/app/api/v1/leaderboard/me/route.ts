/**
 * Personal Rank API
 *
 * GET /api/v1/leaderboard/me?address=0x...&tab=makers|takers&window=7d|30d|all
 *
 * Returns the caller's rank and entry within the full leaderboard.
 * Returns null rank/entry if address has no fills in the window.
 */

import { NextRequest, NextResponse } from "next/server";
import { buildLeaderboard, parseTab, parseWindow } from "@/lib/leaderboard";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const address = searchParams.get("address");
  const tab = parseTab(searchParams.get("tab"));
  const window = parseWindow(searchParams.get("window"));

  if (!address || !/^0x[0-9a-fA-F]{40}$/i.test(address)) {
    return NextResponse.json(
      { error: "Missing or invalid address parameter" },
      { status: 400 }
    );
  }

  const normalizedAddress = address.toLowerCase();

  try {
    // Build full leaderboard (no limit) to find the user's rank
    const result = await buildLeaderboard(tab, window, { limit: 10_000 });

    const userEntry = result.entries.find(
      (e) => e.address === normalizedAddress
    );

    if (!userEntry) {
      return NextResponse.json({
        rank: null,
        entry: null,
        totalParticipants: result.totalParticipants,
      });
    }

    return NextResponse.json({
      rank: userEntry.rank,
      entry: userEntry,
      totalParticipants: result.totalParticipants,
    });
  } catch (err) {
    console.error("[leaderboard/me] Error (returning empty):", err);
    // Return valid empty response instead of 500 — UI renders "no rank"
    return NextResponse.json({
      rank: null,
      entry: null,
      totalParticipants: 0,
    });
  }
}
