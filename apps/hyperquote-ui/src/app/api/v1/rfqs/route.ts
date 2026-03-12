/**
 * GET /api/v1/rfqs — List public RFQs with cursor pagination.
 *
 * Query params:
 *   ?status=open|all    (default: "all")
 *   ?limit=50           (max: 100)
 *   ?cursor=<rfqId>     (cursor-based pagination)
 *
 * Returns: { items: FeedRfq[], nextCursor: string | null }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { Token } from "@/types";

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status") ?? "all";
  const limit = Math.min(
    parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10) || 50,
    100
  );
  const cursor = request.nextUrl.searchParams.get("cursor");

  // Build where clause
  const where: Record<string, unknown> = { visibility: "public" };
  if (status === "open") {
    where.status = { in: ["OPEN", "QUOTED"] };
  }

  try {
    const rfqs = await prisma.feedRfq.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rfqs.length > limit;
    const items = hasMore ? rfqs.slice(0, limit) : rfqs;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    // Parse tokenInJson/tokenOutJson from stored strings
    const parsed = items.map((rfq) => ({
      ...rfq,
      tokenIn: safeParseJson(rfq.tokenInJson),
      tokenOut: safeParseJson(rfq.tokenOutJson),
    }));

    return NextResponse.json({ items: parsed, nextCursor });
  } catch (err) {
    console.error("[rfqs] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

function safeParseJson(json: string): Token | null {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
