/**
 * GET /api/v1/agent/leaderboard — Query leaderboard (role: monitor)
 *
 * Query params:
 *   tab     — "makers" | "takers" (default: "makers")
 *   window  — "7d" | "30d" | "all" (default: "7d")
 *   cursor  — Pagination cursor (address)
 *   limit   — Max entries (default: 100, max: 100)
 *
 * Delegates to existing buildLeaderboard() function.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateAgent, requireRole, logActivity } from "@/lib/agentAuth";
import { buildLeaderboard, parseTab, parseWindow } from "@/lib/leaderboard";

export async function GET(request: NextRequest) {
  const { agent, error } = await authenticateAgent(request);
  if (error) return error;

  const roleError = requireRole(agent, "monitor");
  if (roleError) return roleError;

  const { searchParams } = request.nextUrl;
  const tab = parseTab(searchParams.get("tab") ?? searchParams.get("role"));
  const window = parseWindow(searchParams.get("window"));
  const cursor = searchParams.get("cursor") ?? undefined;
  const limit = Math.min(
    parseInt(searchParams.get("limit") ?? "100", 10) || 100,
    100
  );

  logActivity(agent, "leaderboard.query", { tab, window });

  try {
    const result = await buildLeaderboard(tab, window, {
      limit: limit + 1,
      cursor,
    });

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
    console.error("[agent/leaderboard] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
