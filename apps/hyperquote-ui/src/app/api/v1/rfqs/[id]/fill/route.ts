/**
 * POST /api/v1/rfqs/[id]/fill — Mark an RFQ as filled.
 *
 * Body: { txHash: string }
 *
 * Updates both in-memory registry and Prisma FeedRfq record.
 * Emits rfq.filled SSE event to feed subscribers.
 */

import { NextRequest, NextResponse } from "next/server";
import { markRfqFilled } from "@/lib/rfqRegistry";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: { txHash?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (!body.txHash || !/^0x[0-9a-fA-F]{64}$/.test(body.txHash)) {
    return NextResponse.json(
      { error: "Missing or invalid txHash (expected 0x + 64 hex chars)" },
      { status: 400 }
    );
  }

  await markRfqFilled(id, body.txHash);
  return NextResponse.json({ success: true });
}
