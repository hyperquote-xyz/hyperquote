/**
 * Pool State Refresh API — Phase 4
 *
 * POST /api/v1/sor/pool-state/refresh — Batch refresh stale pool states
 *
 * Body (optional):
 *   {
 *     slugs?: string[],       — Only refresh these protocols
 *     forceRefresh?: boolean,  — Refresh even if state is fresh
 *     limit?: number           — Max pools to refresh (default: 50)
 *   }
 *
 * GET /api/v1/sor/pool-state/refresh — Summary of pool state freshness
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { batchRefreshStates } from "@/lib/router/state";

// Serialiser for BigInt
function serialise(obj: unknown): unknown {
  return JSON.parse(
    JSON.stringify(obj, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value
    )
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { slugs, forceRefresh, limit } = body as {
      slugs?: string[];
      forceRefresh?: boolean;
      limit?: number;
    };

    const result = await batchRefreshStates({
      slugs,
      forceRefresh: forceRefresh ?? false,
      limit: limit ?? 50,
    });

    return NextResponse.json(serialise(result));
  } catch (err) {
    console.error("[pool-state/refresh] POST error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    // Summary of state freshness
    const totalPools = await prisma.pool.count();
    const withState = await prisma.pool.count({
      where: { lastStateBlock: { not: null } },
    });
    const noState = totalPools - withState;

    // Count by status
    const byStatus = await prisma.pool.groupBy({
      by: ["status"],
      _count: true,
    });

    // Count by protocol
    const byProtocol = await prisma.pool.groupBy({
      by: ["slug"],
      _count: true,
      where: { lastStateBlock: { not: null } },
    });

    // Oldest state
    const oldest = await prisma.pool.findFirst({
      where: { lastStateBlock: { not: null } },
      orderBy: { lastStateAt: "asc" },
      select: {
        address: true,
        slug: true,
        lastStateBlock: true,
        lastStateAt: true,
      },
    });

    // Total snapshots
    const totalSnapshots = await prisma.poolStateSnapshot.count();

    return NextResponse.json(
      serialise({
        totalPools,
        withState,
        noState,
        totalSnapshots,
        byStatus: Object.fromEntries(
          byStatus.map((s) => [s.status, s._count])
        ),
        byProtocol: Object.fromEntries(
          byProtocol.map((p) => [p.slug, p._count])
        ),
        oldestState: oldest
          ? {
              address: oldest.address,
              slug: oldest.slug,
              lastStateBlock: oldest.lastStateBlock,
              lastStateAt: oldest.lastStateAt,
            }
          : null,
      })
    );
  } catch (err) {
    console.error("[pool-state/refresh] GET error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
