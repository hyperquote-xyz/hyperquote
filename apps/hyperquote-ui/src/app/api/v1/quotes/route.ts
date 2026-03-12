/**
 * POST /api/v1/quotes — Submit a signed quote for an RFQ.
 *
 * Body: { rfqId: string, quote: RFQQuoteJSON, token?: string }
 *
 * The `token` field is required for private RFQs (the share token).
 * Delegates to rfqRegistry.submitQuote() for validation and broadcast.
 *
 * Returns: { accepted: true } or { accepted: false, reason: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { submitQuote } from "@/lib/rfqRegistry";
import type { RFQQuoteJSON } from "@/types";

export async function POST(request: NextRequest) {
  let body: {
    rfqId: string;
    quote: RFQQuoteJSON;
    token?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { accepted: false, reason: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (!body.rfqId || !body.quote) {
    return NextResponse.json(
      { accepted: false, reason: "Missing rfqId or quote" },
      { status: 400 }
    );
  }

  const result = submitQuote(body.rfqId, body.quote, body.token);

  if (!result.accepted) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result);
}
