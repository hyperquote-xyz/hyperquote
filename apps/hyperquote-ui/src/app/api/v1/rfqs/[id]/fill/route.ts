/**
 * POST /api/v1/rfqs/[id]/fill — Mark an RFQ as filled.
 *
 * AUTHORIZATION: the fill must be backed by a real, successful on-chain
 * `QuoteFilled` event from the RFQ settlement contract. The server fetches the
 * transaction receipt, decodes the event, and requires the event's taker to
 * match the RFQ's requester before recording the fill.
 *
 * Body: { txHash: string }
 *
 * Updates both in-memory registry and Prisma FeedRfq record.
 * Emits rfq.filled SSE event to feed subscribers.
 */

import { NextRequest, NextResponse } from "next/server";
import { markRfqFilled, getRFQOwner } from "@/lib/rfqRegistry";
import { verifyFillTransaction, allowUnverifiedFills } from "@/lib/onchainFill";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: { txHash?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.txHash || !/^0x[0-9a-fA-F]{64}$/.test(body.txHash)) {
    return NextResponse.json(
      { error: "Missing or invalid txHash (expected 0x + 64 hex chars)" },
      { status: 400 }
    );
  }

  if (allowUnverifiedFills()) {
    // Local-dev simulation path only (never active in production).
    console.warn("[rfqs/fill] ALLOW_UNVERIFIED_FILLS active — skipping on-chain verification (dev only)");
    await markRfqFilled(id, body.txHash);
    return NextResponse.json({ success: true, verified: false });
  }

  // Verify the on-chain QuoteFilled event.
  const verified = await verifyFillTransaction(body.txHash);
  if (!verified) {
    return NextResponse.json(
      { error: "Forbidden: txHash does not contain a valid QuoteFilled event from the RFQ contract." },
      { status: 403 }
    );
  }

  // Ensure the on-chain taker matches the RFQ requester.
  const owner = await getRFQOwner(id);
  if (owner && verified.taker !== owner.toLowerCase()) {
    return NextResponse.json(
      { error: "Forbidden: on-chain taker does not match the RFQ requester." },
      { status: 403 }
    );
  }

  await markRfqFilled(id, body.txHash);
  return NextResponse.json({ success: true, verified: true });
}
