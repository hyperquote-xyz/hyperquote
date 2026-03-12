/**
 * GET /api/v1/agent/rfqs/[id]/quotes — Get quotes for an RFQ (role: monitor)
 *
 * Returns all received quotes for the given RFQ ID.
 * Only available for live (in-memory) RFQs.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateAgent, requireRole, logActivity } from "@/lib/agentAuth";
import { getRFQById } from "@/lib/rfqRegistry";

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

  logActivity(agent, "quotes.list", { rfqId: id });

  const result = getRFQById(id, shareToken);
  if (!result) {
    return NextResponse.json(
      { error: "RFQ not found or expired. Quotes are only available for live RFQs." },
      { status: 404 }
    );
  }

  return NextResponse.json({
    rfqId: id,
    quotes: result.quotes,
    count: result.quotes.length,
  });
}
