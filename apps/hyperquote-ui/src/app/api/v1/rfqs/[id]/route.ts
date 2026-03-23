/**
 * GET /api/v1/rfqs/[id] — Get RFQ details by ID (DB-backed, includes quotes).
 */

import { NextRequest, NextResponse } from "next/server";
import { getRFQById } from "@/lib/rfqRegistry";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const shareToken = request.nextUrl.searchParams.get("token") ?? undefined;

  try {
    const result = await getRFQById(id, shareToken);
    if (!result) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      rfq: result.rfq,
      quotes: result.quotes,
      status: "OPEN", // TODO: expose status from DB row
      quoteCount: result.quotes.length,
    });
  } catch (err) {
    console.error("[rfqs/:id] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
