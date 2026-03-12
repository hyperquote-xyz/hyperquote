/**
 * GET /api/v1/agent/auth — Validate API key and return agent info.
 *
 * Headers: Authorization: Bearer hq_live_...
 *
 * Returns: { agentId, name, roles, wallet, owner, rateLimit }
 *
 * Use this to verify your API key is valid and check your agent's config.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/agentAuth";

export async function GET(request: NextRequest) {
  const { agent, error } = await authenticateAgent(request);
  if (error) return error;

  return NextResponse.json({
    agentId: agent.id,
    name: agent.name,
    roles: agent.roles,
    wallet: agent.wallet,
    owner: agent.owner,
    rateLimit: {
      perMinute: agent.rateLimitPerMin,
      perHour: agent.rateLimitPerHour,
    },
  });
}
