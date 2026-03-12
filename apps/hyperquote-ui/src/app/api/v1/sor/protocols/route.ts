/**
 * GET /api/v1/sor/protocols
 *
 * List all protocols in the registry.
 * Optional query params:
 *   ?status=ACTIVE|INACTIVE|all (default: ACTIVE)
 *   ?withConnector=true         (only show protocols that have a connector configured)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getRegistryStats } from "@/lib/router/defillama";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const statusFilter = url.searchParams.get("status") ?? "ACTIVE";
    const withConnector = url.searchParams.get("withConnector") === "true";

    // Build where clause
    const where: Record<string, unknown> = {};
    if (statusFilter !== "all") {
      where.status = statusFilter;
    }
    if (withConnector) {
      where.connector = { isNot: null };
    }

    const [protocols, stats] = await Promise.all([
      prisma.protocolRegistry.findMany({
        where,
        include: {
          connector: {
            select: {
              discoveryMethod: true,
              factoryAbiId: true,
            },
          },
        },
        orderBy: { tvlUsd: "desc" },
      }),
      getRegistryStats(),
    ]);

    return NextResponse.json({
      protocols: protocols.map((p) => ({
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: JSON.parse(p.chains),
        tvlUsd: p.tvlUsd,
        vol24hUsd: p.vol24hUsd,
        status: p.status,
        hasConnector: !!p.connector,
        connectorType: p.connector?.discoveryMethod ?? null,
        updatedAt: p.updatedAt.toISOString(),
      })),
      stats,
      filter: { status: statusFilter, withConnector },
    });
  } catch (err) {
    console.error("[api/v1/sor/protocols] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch protocols" },
      { status: 500 }
    );
  }
}
