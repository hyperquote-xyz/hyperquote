/**
 * GET /api/v1/agent/rfqs/[id] — Get RFQ detail by ID (role: monitor)
 *
 * Returns the RFQ data and all received quotes.
 * For private RFQs, include ?shareToken=... in query params.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateAgent, requireRole, logActivity } from "@/lib/agentAuth";
import { getRFQById } from "@/lib/rfqRegistry";
import { prisma } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { agent, error } = await authenticateAgent(request);
  if (error) return error;

  const roleError = requireRole(agent, "monitor");
  if (roleError) return roleError;

  const { id } = await params;
  const shareToken = request.nextUrl.searchParams.get("shareToken") ?? undefined;

  logActivity(agent, "rfq.detail", { rfqId: id });

  // Try in-memory first (active, non-expired)
  const live = getRFQById(id, shareToken);
  if (live) {
    return NextResponse.json({
      source: "live",
      rfq: live.rfq,
      quotes: live.quotes,
    });
  }

  // Fall back to Prisma (historical / persisted)
  try {
    const feedRfq = await prisma.feedRfq.findUnique({
      where: { id },
    });

    if (!feedRfq) {
      return NextResponse.json(
        { error: "RFQ not found" },
        { status: 404 }
      );
    }

    // Parse stored JSON
    let tokenIn, tokenOut;
    try {
      tokenIn = JSON.parse(feedRfq.tokenInJson);
      tokenOut = JSON.parse(feedRfq.tokenOutJson);
    } catch {
      tokenIn = null;
      tokenOut = null;
    }

    return NextResponse.json({
      source: "db",
      rfq: {
        ...feedRfq,
        tokenIn,
        tokenOut,
      },
      quotes: [], // Quotes are only available in-memory while RFQ is live
    });
  } catch (err) {
    console.error("[agent/rfqs/id] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
