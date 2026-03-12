/**
 * GET /api/v1/feed/stream — Server-Sent Events stream for the public RFQ feed.
 *
 * On connect:
 *   - Starts the expiry scanner (once globally)
 *   - Sends a "snapshot" event with recent FeedRfqs from Prisma (persistent)
 *   - Then streams live FeedEvent payloads as they arrive
 *
 * Event types:
 *   rfq.created, rfq.quoted, rfq.filled, rfq.cancelled, rfq.expired
 *
 * Sends a keep-alive comment every 15 seconds.
 */

import { NextRequest } from "next/server";
import { addFeedSubscriber, startExpiryScanner } from "@/lib/rfqRegistry";
import { prisma } from "@/lib/db";

export async function GET(_request: NextRequest) {
  // Ensure expiry scanner is running
  startExpiryScanner();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const writer = {
        write: (data: string) => {
          try {
            controller.enqueue(encoder.encode(data));
          } catch {
            // Stream closed
          }
        },
        close: () => {
          try {
            controller.close();
          } catch {
            // Already closed
          }
        },
      };

      // Send snapshot: recent FeedRfqs from Prisma (persistent, survives restart)
      try {
        const recent = await prisma.feedRfq.findMany({
          where: { visibility: "public" },
          orderBy: { createdAt: "desc" },
          take: 100,
        });
        writer.write(
          `data: ${JSON.stringify({ type: "snapshot", data: recent })}\n\n`
        );
      } catch {
        // Prisma may fail — send empty snapshot
        writer.write(
          `data: ${JSON.stringify({ type: "snapshot", data: [] })}\n\n`
        );
      }

      // Register for live feed events
      const unsubscribe = addFeedSubscriber(writer);

      // Keep-alive ping every 15s
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          // Stream closed — clean up
          clearInterval(keepAlive);
          unsubscribe();
        }
      }, 15_000);

      // Clean up when the client disconnects
      _request.signal.addEventListener("abort", () => {
        clearInterval(keepAlive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// Force dynamic — SSE must not be statically generated
export const dynamic = "force-dynamic";
