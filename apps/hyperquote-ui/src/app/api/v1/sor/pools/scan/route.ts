/**
 * POST /api/v1/sor/pools/scan
 *
 * Triggers factory event scanning for pool discovery.
 *
 * Optional body params:
 *   { slugs?: string[], fromBlock?: number }
 *
 * GET /api/v1/sor/pools/scan
 *   Returns pool counts and last scan info per protocol.
 */

import { NextRequest, NextResponse } from "next/server";
import { scanAllProtocols } from "@/lib/router/scanner";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    let body: { slugs?: string[]; fromBlock?: number } = {};
    try {
      body = await req.json();
    } catch {
      // No body — scan all
    }

    console.log("[api/v1/sor/pools/scan] Starting scan...", body);

    const result = await scanAllProtocols({
      slugs: body.slugs,
      fromBlock: body.fromBlock !== undefined ? BigInt(body.fromBlock) : undefined,
    });

    // Serialize bigints for JSON
    const serialized = {
      ...result,
      latestBlock: result.latestBlock.toString(),
      protocols: result.protocols.map((p) => ({
        ...p,
        scannedFromBlock: p.scannedFromBlock.toString(),
        scannedToBlock: p.scannedToBlock.toString(),
      })),
    };

    const status = result.totalErrors > 0 ? 207 : 200;
    return NextResponse.json(serialized, { status });
  } catch (err) {
    console.error("[api/v1/sor/pools/scan] Error:", err);
    return NextResponse.json(
      { error: "Scan failed", details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    // Pool counts per protocol
    const pools = await prisma.pool.groupBy({
      by: ["slug"],
      _count: { poolId: true },
      orderBy: { _count: { poolId: "desc" } },
    });

    // Total pool count
    const totalPools = await prisma.pool.count();
    const totalTokens = await prisma.token.count();

    // Last scanned block per protocol
    const lastBlocks = await prisma.pool.groupBy({
      by: ["slug"],
      _max: { createdBlock: true },
    });

    const lastBlockMap = new Map(
      lastBlocks.map((lb) => [lb.slug, lb._max.createdBlock?.toString() ?? null])
    );

    return NextResponse.json({
      totalPools,
      totalTokens,
      protocols: pools.map((p) => ({
        slug: p.slug,
        poolCount: p._count.poolId,
        lastScannedBlock: lastBlockMap.get(p.slug) ?? null,
      })),
    });
  } catch (err) {
    console.error("[api/v1/sor/pools/scan] GET Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch scan status" },
      { status: 500 }
    );
  }
}
