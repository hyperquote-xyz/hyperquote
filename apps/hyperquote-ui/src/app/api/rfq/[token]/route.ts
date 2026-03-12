import { NextRequest, NextResponse } from "next/server";
import { getRFQByShareToken } from "@/lib/rfqRegistry";

/**
 * GET /api/rfq/[token] — Retrieve a private RFQ by its share token.
 *
 * Returns the RFQ data if found and not expired, or 404.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!token) {
    return NextResponse.json(
      { error: "Missing share token" },
      { status: 400 }
    );
  }

  const rfqData = getRFQByShareToken(token);

  if (!rfqData) {
    return NextResponse.json(
      { error: "Not found or expired" },
      { status: 404 }
    );
  }

  return NextResponse.json(rfqData);
}
