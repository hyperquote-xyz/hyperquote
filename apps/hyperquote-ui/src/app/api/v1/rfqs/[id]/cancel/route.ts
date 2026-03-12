/**
 * POST /api/v1/rfqs/[id]/cancel — Mark an RFQ as cancelled/killed.
 *
 * Updates both in-memory registry and Prisma FeedRfq record.
 * Emits rfq.cancelled SSE event to feed subscribers.
 */

import { NextRequest, NextResponse } from "next/server";
import { markRfqCancelled } from "@/lib/rfqRegistry";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await markRfqCancelled(id);
  return NextResponse.json({ success: true });
}
