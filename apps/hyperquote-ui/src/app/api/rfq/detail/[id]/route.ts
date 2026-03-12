import { NextRequest, NextResponse } from "next/server";
import { getRFQById } from "@/lib/rfqRegistry";

/**
 * GET /api/rfq/detail/[id] — Retrieve an RFQ by its request ID.
 *
 * Public RFQs: accessible directly.
 * Private RFQs: require ?token=<shareToken> query parameter.
 *
 * Returns: { rfq: RFQRequestJSON, quotes: RFQQuoteJSON[] } or 404.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Missing RFQ id" },
      { status: 400 }
    );
  }

  // Private RFQs need the share token
  const shareToken = request.nextUrl.searchParams.get("token") ?? undefined;

  const result = getRFQById(id, shareToken);

  if (!result) {
    return NextResponse.json(
      { error: "Not found, expired, or access denied" },
      { status: 404 }
    );
  }

  return NextResponse.json(result);
}
