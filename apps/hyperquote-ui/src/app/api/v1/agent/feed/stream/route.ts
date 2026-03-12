/**
 * GET /api/v1/agent/feed/stream — Authenticated SSE stream for agent feed (role: monitor)
 *
 * Same as /api/v1/feed/stream but requires Bearer auth.
 * On connect:
 *   - Enforces per-agent connection limit (max 3 concurrent)
 *   - Sends a "snapshot" event with recent FeedRfqs
 *   - Streams live FeedEvent payloads (rfq.created, rfq.quoted, rfq.filled, etc.)
 *   - Keep-alive every 15s
 *
 * Headers: Authorization: Bearer hq_live_...
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateAgent, requireRole, logActivity } from "@/lib/agentAuth";
import { addFeedSubscriber, startExpiryScanner } from "@/lib/rfqRegistry";
import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// Per-agent connection tracking — prevents SSE connection bombing
// ---------------------------------------------------------------------------

const MAX_CONNECTIONS_PER_AGENT = 3;
const agentConnectionCounts = new Map<string, number>();

function acquireConnection(agentId: string): boolean {
  const current = agentConnectionCounts.get(agentId) ?? 0;
  if (current >= MAX_CONNECTIONS_PER_AGENT) {
    return false;
  }
  agentConnectionCounts.set(agentId, current + 1);
  return true;
}

function releaseConnection(agentId: string): void {
  const current = agentConnectionCounts.get(agentId) ?? 0;
  if (current <= 1) {
    agentConnectionCounts.delete(agentId);
  } else {
    agentConnectionCounts.set(agentId, current - 1);
  }
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const { agent, error } = await authenticateAgent(request);
  if (error) return error;

  const roleError = requireRole(agent, "monitor");
  if (roleError) return roleError;

  // Enforce per-agent connection limit
  if (!acquireConnection(agent.id)) {
    return NextResponse.json(
      {
        error: `Maximum ${MAX_CONNECTIONS_PER_AGENT} concurrent SSE connections per agent. Close an existing connection first.`,
      },
      { status: 429 }
    );
  }

  logActivity(agent, "feed.connect");

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

      // Send snapshot: recent FeedRfqs from Prisma
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
        writer.write(
          `data: ${JSON.stringify({ type: "snapshot", data: [] })}\n\n`
        );
      }

      // Send connected event with agent info
      writer.write(
        `data: ${JSON.stringify({
          type: "connected",
          agentId: agent.id,
          agentName: agent.name,
        })}\n\n`
      );

      // Register for live feed events
      const unsubscribe = addFeedSubscriber(writer);

      // Keep-alive ping every 15s
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          clearInterval(keepAlive);
          unsubscribe();
          releaseConnection(agent.id);
        }
      }, 15_000);

      // Clean up on disconnect
      request.signal.addEventListener("abort", () => {
        clearInterval(keepAlive);
        unsubscribe();
        releaseConnection(agent.id);
        logActivity(agent, "feed.disconnect");
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

export const dynamic = "force-dynamic";
