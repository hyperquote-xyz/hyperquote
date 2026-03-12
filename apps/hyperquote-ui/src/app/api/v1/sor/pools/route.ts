/**
 * GET /api/v1/sor/pools
 *
 * List discovered pools with optional filters.
 * Query params:
 *   ?slug=hyperswap-v2         Filter by protocol
 *   ?token=0x...               Filter by token (in either position)
 *   ?status=ACTIVE             Filter by pool status (default: ACTIVE)
 *   ?limit=100                 Max results (default: 100, max: 1000)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeAddress } from "@/lib/router/address";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get("slug");
    const token = url.searchParams.get("token");
    const status = url.searchParams.get("status") ?? "ACTIVE";
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 1000);

    const where: Record<string, unknown> = {};
    if (slug) where.slug = slug;
    if (status !== "all") where.status = status;
    if (token) {
      const normalizedToken = normalizeAddress(token);
      where.OR = [{ token0Addr: normalizedToken }, { token1Addr: normalizedToken }];
    }

    const [pools, total] = await Promise.all([
      prisma.pool.findMany({
        where,
        include: {
          token0: { select: { symbol: true, decimals: true } },
          token1: { select: { symbol: true, decimals: true } },
          protocol: { select: { name: true } },
        },
        orderBy: { createdBlock: "desc" },
        take: limit,
      }),
      prisma.pool.count({ where }),
    ]);

    return NextResponse.json({
      pools: pools.map((p) => ({
        poolId: p.poolId,
        protocol: p.protocol.name,
        slug: p.slug,
        poolType: p.poolType,
        address: p.address,
        token0: { address: p.token0Addr, symbol: p.token0.symbol, decimals: p.token0.decimals },
        token1: { address: p.token1Addr, symbol: p.token1.symbol, decimals: p.token1.decimals },
        feeBps: p.feeBps,
        tickSpacing: p.tickSpacing,
        status: p.status,
        createdBlock: p.createdBlock?.toString() ?? null,
      })),
      total,
      limit,
    });
  } catch (err) {
    console.error("[api/v1/sor/pools] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch pools" },
      { status: 500 }
    );
  }
}
