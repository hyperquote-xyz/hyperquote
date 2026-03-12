/**
 * GET /api/v1/internal/events — Internal SSE stream for ALL RFQ events.
 *
 * Unlike the public /api/v1/feed/stream, this endpoint:
 *   - Includes BOTH public and private RFQ events
 *   - Includes allowedMakers metadata for private RFQ ACL enforcement
 *   - Is secured by a shared secret (INTERNAL_EVENT_SECRET)
 *   - Does NOT send a Prisma snapshot — live events only
 *
 * Consumed by the alert-stream WebSocket service.
 *
 * Auth: Authorization: Internal <INTERNAL_EVENT_SECRET>
 */

import { NextRequest } from "next/server";
import { addInternalSubscriber, startExpiryScanner } from "@/lib/rfqRegistry";

const INTERNAL_EVENT_SECRET = process.env.INTERNAL_EVENT_SECRET;

export async function GET(request: NextRequest) {
  // Validate internal auth
  if (!INTERNAL_EVENT_SECRET) {
    return new Response(
      JSON.stringify({ error: "Internal events not configured" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Internal ")) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid Authorization header. Use: Internal <secret>" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const providedSecret = authHeader.slice(9).trim();
  if (providedSecret !== INTERNAL_EVENT_SECRET) {
    return new Response(
      JSON.stringify({ error: "Invalid internal secret" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  // Ensure expiry scanner is running
  startExpiryScanner();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
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

      // Send a connected confirmation
      writer.write(
        `data: ${JSON.stringify({ type: "connected", timestamp: Math.floor(Date.now() / 1000) })}\n\n`
      );

      // Register for internal events (all visibility levels)
      const unsubscribe = addInternalSubscriber(writer);

      // Keep-alive ping every 15s
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          clearInterval(keepAlive);
          unsubscribe();
        }
      }, 15_000);

      // Clean up when the client disconnects
      request.signal.addEventListener("abort", () => {
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
