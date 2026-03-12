import { NextRequest } from "next/server";
import { listPublicRFQs, addSSESubscriber } from "@/lib/rfqRegistry";

/**
 * GET /api/rfq/stream — Server-Sent Events stream for the public RFQ feed.
 *
 * On connect:
 *   - Sends a "snapshot" event with all current public RFQs
 *   - Then streams live "rfq" and "quote" events as they arrive
 *
 * Event format:
 *   data: {"type":"snapshot","data":[...RFQRequestJSON[]]}
 *   data: {"type":"rfq","data":{...RFQRequestJSON}}
 *   data: {"type":"quote","rfqId":"...","data":{...RFQQuoteJSON}}
 *
 * Sends a keep-alive comment every 15 seconds.
 */
export async function GET(_request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Helper to write SSE data
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

      // Send initial snapshot of all public RFQs
      const snapshot = listPublicRFQs();
      writer.write(`data: ${JSON.stringify({ type: "snapshot", data: snapshot })}\n\n`);

      // Register for live updates
      const unsubscribe = addSSESubscriber(writer);

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
