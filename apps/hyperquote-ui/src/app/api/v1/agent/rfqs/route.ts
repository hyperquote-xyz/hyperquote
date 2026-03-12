/**
 * Agent RFQ Routes
 *
 * GET  /api/v1/agent/rfqs — List active public RFQs (role: monitor)
 * POST /api/v1/agent/rfqs — Create a new RFQ (role: taker)
 *
 * All routes require Bearer auth via agentAuth.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  authenticateAgent,
  requireRole,
  logActivity,
  getClientIp,
} from "@/lib/agentAuth";
import {
  registerRFQ,
  listPublicRFQs,
  startExpiryScanner,
} from "@/lib/rfqRegistry";
import { prisma } from "@/lib/db";
import type { Token, RFQRequestJSON } from "@/types";
import { QuoteKind } from "@/types";
import { getTokenByAddress, getTokenBySymbol } from "@/config/tokens";

// ---------------------------------------------------------------------------
// GET — List RFQs
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const { agent, error } = await authenticateAgent(request);
  if (error) return error;

  const roleError = requireRole(agent, "monitor");
  if (roleError) return roleError;

  const { searchParams } = request.nextUrl;
  const source = searchParams.get("source") ?? "live"; // "live" | "db" | "both"
  const status = searchParams.get("status") ?? "all"; // "open" | "all"
  const limit = Math.min(
    parseInt(searchParams.get("limit") ?? "50", 10) || 50,
    100
  );

  logActivity(agent, "rfqs.list", { source, status });

  try {
    if (source === "live") {
      // In-memory active RFQs (volatile, fast)
      const rfqs = listPublicRFQs();
      return NextResponse.json({ items: rfqs, source: "live" });
    }

    if (source === "db") {
      // Prisma-persisted RFQs (durable, paginated)
      const where: Record<string, unknown> = { visibility: "public" };
      if (status === "open") {
        where.status = { in: ["OPEN", "QUOTED"] };
      }
      const cursor = searchParams.get("cursor") ?? undefined;
      const rfqs = await prisma.feedRfq.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      const hasMore = rfqs.length > limit;
      const items = hasMore ? rfqs.slice(0, limit) : rfqs;
      const nextCursor = hasMore ? items[items.length - 1].id : null;

      // Parse tokenInJson/tokenOutJson
      const parsed = items.map((rfq) => ({
        ...rfq,
        tokenIn: safeParseJson(rfq.tokenInJson),
        tokenOut: safeParseJson(rfq.tokenOutJson),
      }));

      return NextResponse.json({ items: parsed, nextCursor, source: "db" });
    }

    // "both" — merge live + recent from DB
    const live = listPublicRFQs();
    const recent = await prisma.feedRfq.findMany({
      where: { visibility: "public" },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const recentParsed = recent.map((rfq) => ({
      ...rfq,
      tokenIn: safeParseJson(rfq.tokenInJson),
      tokenOut: safeParseJson(rfq.tokenOutJson),
    }));

    return NextResponse.json({
      live,
      recent: recentParsed,
      source: "both",
    });
  } catch (err) {
    console.error("[agent/rfqs] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST — Create RFQ
// ---------------------------------------------------------------------------

interface CreateRFQBody {
  tokenIn: string; // address or symbol
  tokenOut: string; // address or symbol
  amountIn?: string; // BigInt string (for EXACT_IN)
  amountOut?: string; // BigInt string (for EXACT_OUT)
  kind?: number; // QuoteKind: 0=EXACT_IN, 1=EXACT_OUT (default: 0)
  ttlSeconds?: number; // Time to live (default: 30)
  visibility?: "public" | "private";
  allowedMakers?: string[];
}

export async function POST(request: NextRequest) {
  const { agent, error } = await authenticateAgent(request);
  if (error) return error;

  const roleError = requireRole(agent, "taker");
  if (roleError) return roleError;

  let body: CreateRFQBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // ── Resolve tokens ──

  const tokenIn = resolveToken(body.tokenIn);
  const tokenOut = resolveToken(body.tokenOut);

  if (!tokenIn) {
    return NextResponse.json(
      { error: `Unknown tokenIn: ${body.tokenIn}. Use address or symbol.` },
      { status: 400 }
    );
  }
  if (!tokenOut) {
    return NextResponse.json(
      { error: `Unknown tokenOut: ${body.tokenOut}. Use address or symbol.` },
      { status: 400 }
    );
  }

  // ── Validate amounts ──

  const kind = body.kind ?? QuoteKind.EXACT_IN;
  if (kind === QuoteKind.EXACT_IN && !body.amountIn) {
    return NextResponse.json(
      { error: "amountIn is required for EXACT_IN" },
      { status: 400 }
    );
  }
  if (kind === QuoteKind.EXACT_OUT && !body.amountOut) {
    return NextResponse.json(
      { error: "amountOut is required for EXACT_OUT" },
      { status: 400 }
    );
  }

  // Validate BigInt strings
  try {
    if (body.amountIn) BigInt(body.amountIn);
    if (body.amountOut) BigInt(body.amountOut);
  } catch {
    return NextResponse.json(
      { error: "amountIn/amountOut must be valid BigInt strings" },
      { status: 400 }
    );
  }

  // ── Build RFQ ──

  const ttl = Math.min(Math.max(body.ttlSeconds ?? 30, 10), 300); // 10s–5min
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + ttl;
  const rfqId = crypto.randomUUID();
  const visibility = body.visibility ?? "public";

  const rfqData: RFQRequestJSON = {
    id: rfqId,
    kind,
    taker: agent.wallet,
    tokenIn,
    tokenOut,
    amountIn: body.amountIn ?? undefined,
    amountOut: body.amountOut ?? undefined,
    expiry,
    createdAt: now,
    visibility,
    allowedMakers: body.allowedMakers,
  };

  // Ensure expiry scanner is running
  startExpiryScanner();

  // Register in the in-memory registry (handles limits, rate limiting, SSE, Prisma)
  const ip = getClientIp(request);
  const result = registerRFQ({
    wallet: agent.wallet,
    visibility,
    expiry,
    rfqData,
    ip,
  });

  if (!result.allowed) {
    return NextResponse.json(
      { error: result.reason, activeCount: result.activeCount },
      { status: 429 }
    );
  }

  logActivity(agent, "rfq.create", {
    rfqId,
    tokenIn: tokenIn.symbol,
    tokenOut: tokenOut.symbol,
    ipAddress: ip,
  });

  return NextResponse.json(
    {
      rfqId,
      shareToken: result.shareToken,
      expiry,
      ttlSeconds: ttl,
      activeCount: result.activeCount,
    },
    { status: 201 }
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveToken(input: string): Token | undefined {
  if (!input) return undefined;

  // Try as address first (0x...)
  if (input.startsWith("0x")) {
    return getTokenByAddress(input);
  }

  // Try as symbol
  return getTokenBySymbol(input);
}

function safeParseJson(json: string): Token | null {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export const dynamic = "force-dynamic";
