/**
 * POST /api/v1/agent/keys/rotate — Rotate an agent's API key
 *
 * Authenticated with the CURRENT API key. Generates a new key,
 * invalidates the old one, and returns the new key (shown once).
 *
 * The old key stops working immediately after rotation.
 *
 * Body: (none required)
 *
 * Returns:
 *   { agentId, apiKey, prefix, rotatedAt }
 *   The new API key is shown ONCE — store it securely.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  authenticateAgent,
  generateApiKey,
  logActivity,
  getClientIp,
} from "@/lib/agentAuth";
import { prisma } from "@/lib/db";

export async function POST(request: NextRequest) {
  const { agent, error } = await authenticateAgent(request);
  if (error) return error;

  // Generate a new key
  const { rawKey, hash, prefix } = await generateApiKey();

  try {
    // Atomically update the agent's key hash and prefix
    await prisma.agent.update({
      where: { id: agent.id },
      data: {
        apiKeyHash: hash,
        apiKeyPrefix: prefix,
        updatedAt: new Date(),
      },
    });

    logActivity(agent, "key.rotated", {
      newPrefix: prefix,
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({
      agentId: agent.id,
      apiKey: rawKey, // Shown ONCE — store securely
      prefix,
      rotatedAt: new Date().toISOString(),
      message: "API key rotated successfully. The old key is now invalid.",
    });
  } catch (err) {
    console.error("[agent/keys/rotate] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Key rotation failed" },
      { status: 500 }
    );
  }
}
