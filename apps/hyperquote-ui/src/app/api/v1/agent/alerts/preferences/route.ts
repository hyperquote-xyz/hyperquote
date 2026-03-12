/**
 * GET/PUT /api/v1/agent/alerts/preferences — Alert subscription preferences.
 *
 * GET  — Returns the agent's alert preferences (or defaults if none stored).
 * PUT  — Upserts alert preferences with validation.
 *
 * Auth: Bearer hq_live_... (agent API key)
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateAgent, logActivity } from "@/lib/agentAuth";
import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// Validation constants
// ---------------------------------------------------------------------------

const VALID_VISIBILITY = ["all", "public", "private"] as const;
const VALID_SIDE = ["all", "buy", "sell"] as const;
const VALID_EVENT_TYPES = ["rfq.created", "rfq.filled"] as const;
const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;
const MAX_TOKENS = 50; // cap to prevent abuse

// ---------------------------------------------------------------------------
// Default preferences (returned when agent has no stored preferences)
// ---------------------------------------------------------------------------

const DEFAULT_PREFERENCES = {
  enabled: true,
  tokens: [] as string[],
  minNotionalUsd: 0,
  visibility: "all" as const,
  side: "all" as const,
  eventTypes: ["rfq.created", "rfq.filled"] as string[],
};

// ---------------------------------------------------------------------------
// GET /api/v1/agent/alerts/preferences
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const auth = await authenticateAgent(request);
  if (auth.error) return auth.error;

  const { agent } = auth;

  try {
    const pref = await prisma.alertPreference.findUnique({
      where: { agentId: agent.id },
    });

    if (!pref) {
      return NextResponse.json({
        ...DEFAULT_PREFERENCES,
        agentId: agent.id,
      });
    }

    // Parse JSON fields
    let tokens: string[];
    try {
      tokens = JSON.parse(pref.tokens);
    } catch {
      tokens = [];
    }

    let eventTypes: string[];
    try {
      eventTypes = JSON.parse(pref.eventTypes);
    } catch {
      eventTypes = ["rfq.created", "rfq.filled"];
    }

    return NextResponse.json({
      agentId: agent.id,
      enabled: pref.enabled,
      tokens,
      minNotionalUsd: pref.minNotionalUsd,
      visibility: pref.visibility,
      side: pref.side,
      eventTypes,
      createdAt: pref.createdAt,
      updatedAt: pref.updatedAt,
    });
  } catch (err) {
    console.error("[alerts/preferences] GET failed:", err);
    return NextResponse.json(
      { error: "Failed to retrieve preferences" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PUT /api/v1/agent/alerts/preferences
// ---------------------------------------------------------------------------

export async function PUT(request: NextRequest) {
  const auth = await authenticateAgent(request);
  if (auth.error) return auth.error;

  const { agent } = auth;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // --- Validate each field ---

  const errors: string[] = [];

  // enabled
  let enabled = DEFAULT_PREFERENCES.enabled;
  if ("enabled" in body) {
    if (typeof body.enabled !== "boolean") {
      errors.push("enabled must be a boolean");
    } else {
      enabled = body.enabled;
    }
  }

  // tokens — lowercase, dedupe, cap at MAX_TOKENS
  let tokens = DEFAULT_PREFERENCES.tokens;
  if ("tokens" in body) {
    if (!Array.isArray(body.tokens)) {
      errors.push("tokens must be an array of 0x addresses");
    } else if (body.tokens.length > MAX_TOKENS) {
      errors.push(`tokens array exceeds maximum of ${MAX_TOKENS} entries`);
    } else {
      const invalid = (body.tokens as unknown[]).filter(
        (t) => typeof t !== "string" || !ADDRESS_REGEX.test(t as string)
      );
      if (invalid.length > 0) {
        errors.push(
          `Invalid token addresses: ${invalid.map(String).join(", ")}. Each must match 0x[0-9a-fA-F]{40}`
        );
      } else {
        // Lowercase + dedupe
        tokens = [...new Set((body.tokens as string[]).map((t) => t.toLowerCase()))];
      }
    }
  }

  // minNotionalUsd — reject NaN, Infinity, negative
  let minNotionalUsd = DEFAULT_PREFERENCES.minNotionalUsd;
  if ("minNotionalUsd" in body) {
    if (
      typeof body.minNotionalUsd !== "number" ||
      !Number.isFinite(body.minNotionalUsd) ||
      body.minNotionalUsd < 0
    ) {
      errors.push("minNotionalUsd must be a finite non-negative number");
    } else {
      minNotionalUsd = body.minNotionalUsd;
    }
  }

  // visibility
  let visibility = DEFAULT_PREFERENCES.visibility;
  if ("visibility" in body) {
    if (
      typeof body.visibility !== "string" ||
      !(VALID_VISIBILITY as readonly string[]).includes(body.visibility)
    ) {
      errors.push(`visibility must be one of: ${VALID_VISIBILITY.join(", ")}`);
    } else {
      visibility = body.visibility as typeof visibility;
    }
  }

  // side
  let side = DEFAULT_PREFERENCES.side;
  if ("side" in body) {
    if (
      typeof body.side !== "string" ||
      !(VALID_SIDE as readonly string[]).includes(body.side)
    ) {
      errors.push(`side must be one of: ${VALID_SIDE.join(", ")}`);
    } else {
      side = body.side as typeof side;
    }
  }

  // eventTypes — dedupe, validate
  let eventTypes = DEFAULT_PREFERENCES.eventTypes;
  if ("eventTypes" in body) {
    if (!Array.isArray(body.eventTypes) || body.eventTypes.length === 0) {
      errors.push("eventTypes must be a non-empty array");
    } else {
      const validSet = new Set<string>(VALID_EVENT_TYPES);
      const invalid = (body.eventTypes as unknown[]).filter(
        (t) => typeof t !== "string" || !validSet.has(t as string)
      );
      if (invalid.length > 0) {
        errors.push(
          `Invalid event types: ${invalid.map(String).join(", ")}. Allowed: ${VALID_EVENT_TYPES.join(", ")}`
        );
      } else {
        // Dedupe
        eventTypes = [...new Set(body.eventTypes as string[])];
      }
    }
  }

  if (errors.length > 0) {
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 400 }
    );
  }

  // --- Upsert ---
  try {
    const pref = await prisma.alertPreference.upsert({
      where: { agentId: agent.id },
      create: {
        agentId: agent.id,
        enabled,
        tokens: JSON.stringify(tokens),
        minNotionalUsd,
        visibility,
        side,
        eventTypes: JSON.stringify(eventTypes),
      },
      update: {
        enabled,
        tokens: JSON.stringify(tokens),
        minNotionalUsd,
        visibility,
        side,
        eventTypes: JSON.stringify(eventTypes),
      },
    });

    logActivity(agent, "alerts.preferences.update", {
      visibility,
      side,
      tokenCount: tokens.length,
      eventTypes,
    });

    return NextResponse.json({
      agentId: agent.id,
      enabled: pref.enabled,
      tokens,
      minNotionalUsd: pref.minNotionalUsd,
      visibility: pref.visibility,
      side: pref.side,
      eventTypes,
      createdAt: pref.createdAt,
      updatedAt: pref.updatedAt,
    });
  } catch (err) {
    console.error("[alerts/preferences] PUT failed:", err);
    return NextResponse.json(
      { error: "Failed to save preferences" },
      { status: 500 }
    );
  }
}
