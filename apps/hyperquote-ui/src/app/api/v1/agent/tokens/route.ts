/**
 * GET /api/v1/agent/tokens — List available tokens (role: monitor)
 *
 * Query params:
 *   tier  — Filter by tier: "core" | "verified" | "all" (default: "verified")
 *   q     — Search by symbol or name (case-insensitive substring)
 *
 * Returns array of Token objects.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateAgent, requireRole, logActivity } from "@/lib/agentAuth";
import {
  CORE_TOKENS,
  DEFAULT_TOKENS,
  ALL_TOKENS,
  WHYPE_TOKEN,
} from "@/config/tokens";
import type { Token } from "@/types";

export async function GET(request: NextRequest) {
  const { agent, error } = await authenticateAgent(request);
  if (error) return error;

  const roleError = requireRole(agent, "monitor");
  if (roleError) return roleError;

  const { searchParams } = request.nextUrl;
  const tier = searchParams.get("tier") ?? "verified";
  const query = searchParams.get("q")?.toLowerCase();

  logActivity(agent, "tokens.list", { tier });

  let tokens: Token[];

  switch (tier) {
    case "core":
      tokens = [...CORE_TOKENS, WHYPE_TOKEN];
      break;
    case "all":
      tokens = ALL_TOKENS;
      break;
    case "verified":
    default:
      tokens = DEFAULT_TOKENS;
      break;
  }

  // Filter by search query
  if (query) {
    tokens = tokens.filter(
      (t) =>
        t.symbol.toLowerCase().includes(query) ||
        t.name.toLowerCase().includes(query) ||
        t.address.toLowerCase().includes(query)
    );
  }

  return NextResponse.json({
    count: tokens.length,
    tier,
    tokens: tokens.map((t) => ({
      address: t.address,
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
      tier: t.tier,
      verified: t.verified,
      logoUrl: t.logoUrl,
      venue: t.venue,
      isNative: t.isNative ?? false,
      wrappedAddress: t.wrappedAddress,
      hyperliquidCoin: t.hyperliquidCoin,
    })),
  });
}
