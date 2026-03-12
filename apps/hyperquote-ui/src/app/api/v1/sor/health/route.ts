/**
 * SOR Health API — Phase 10
 *
 * GET /api/v1/sor/health
 *
 * Returns the health status of the Smart Order Router including:
 *   - Overall status (healthy/degraded/unhealthy)
 *   - Quote metrics (count, timing, cache hit rate)
 *   - Database stats (protocols, pools, tokens, snapshots)
 *   - RPC connectivity
 *   - Warnings
 */

import { NextResponse } from "next/server";
import { getHealthStatus } from "@/lib/router/safety";

export async function GET() {
  try {
    const health = await getHealthStatus();

    const statusCode =
      health.status === "unhealthy" ? 503 :
      health.status === "degraded" ? 200 :
      200;

    return NextResponse.json(health, { status: statusCode });
  } catch (err) {
    console.error("[sor/health] Error:", err);
    return NextResponse.json(
      {
        status: "unhealthy",
        error: err instanceof Error ? err.message : "Internal error",
      },
      { status: 503 }
    );
  }
}
