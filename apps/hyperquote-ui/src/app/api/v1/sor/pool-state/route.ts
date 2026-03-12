/**
 * Pool State API — Phase 4
 *
 * GET  /api/v1/sor/pool-state?poolId=...  — Get state for a single pool
 * GET  /api/v1/sor/pool-state?address=... — Get state by pool address
 * POST /api/v1/sor/pool-state/refresh     — Batch refresh stale pools
 *
 * Query params:
 *   poolId    — UUID of the pool
 *   address   — Contract address of the pool
 *   force     — "true" to force refresh even if cached state is fresh
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPoolState } from "@/lib/router/state";
import { normalizeAddress } from "@/lib/router/address";

// Serialiser for BigInt
function serialise(obj: unknown): unknown {
  return JSON.parse(
    JSON.stringify(obj, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value
    )
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const poolId = searchParams.get("poolId");
  const address = searchParams.get("address");
  const force = searchParams.get("force") === "true";

  if (!poolId && !address) {
    return NextResponse.json(
      { error: "Provide poolId or address query param" },
      { status: 400 }
    );
  }

  try {
    // Resolve poolId from address if needed
    let resolvedPoolId = poolId;
    if (!resolvedPoolId && address) {
      const normalizedAddr = normalizeAddress(address);
      const pool = await prisma.pool.findUnique({
        where: { address: normalizedAddr },
        select: { poolId: true },
      });
      if (!pool) {
        return NextResponse.json(
          { error: `No pool found with address ${address}` },
          { status: 404 }
        );
      }
      resolvedPoolId = pool.poolId;
    }

    const result = await getPoolState(resolvedPoolId!, {
      forceRefresh: force,
    });

    if (!result) {
      return NextResponse.json(
        { error: "Pool not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(serialise(result));
  } catch (err) {
    console.error("[pool-state] GET error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
