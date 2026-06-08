/**
 * POST /api/v1/rfqs/[id]/cancel — Mark an RFQ as cancelled/killed.
 *
 * AUTHORIZATION: only the RFQ's taker (requester) may cancel it. The caller
 * must supply an EIP-191 wallet signature over `HyperQuote: cancel RFQ {id}`.
 * The server recovers the signer and requires it to equal the RFQ's taker.
 *
 * Body: { signature: "0x..." }
 *
 * Updates both in-memory registry and Prisma FeedRfq record.
 * Emits rfq.cancelled SSE event to feed subscribers.
 */

import { NextRequest, NextResponse } from "next/server";
import { markRfqCancelled, getRFQOwner } from "@/lib/rfqRegistry";
import { verifyWalletSignature, cancelRfqMessage } from "@/lib/walletAuth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: { signature?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.signature) {
    return NextResponse.json(
      { error: "Missing signature. Sign 'HyperQuote: cancel RFQ <id>' with the requester wallet." },
      { status: 401 }
    );
  }

  // Resolve the RFQ's taker (owner).
  const owner = await getRFQOwner(id);
  if (!owner) {
    return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
  }

  // Verify the signature was produced by the taker.
  const valid = await verifyWalletSignature(owner, cancelRfqMessage(id), body.signature);
  if (!valid) {
    return NextResponse.json(
      { error: "Forbidden: signature does not match the RFQ requester." },
      { status: 403 }
    );
  }

  await markRfqCancelled(id);
  return NextResponse.json({ success: true });
}
