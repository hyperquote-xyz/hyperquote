/**
 * Auth module — validates agent tokens by calling the Next.js API.
 *
 * Does NOT access Prisma directly. All validation goes through
 * the Next.js app's /api/v1/agent/auth endpoint.
 */

import type {
  AgentAuthInfo,
  AlertPreferencesResponse,
  AlertSubscription,
} from "./types.js";

const NEXTJS_URL = process.env.NEXTJS_URL ?? "http://localhost:3000";

// ---------------------------------------------------------------------------
// Validate agent token
// ---------------------------------------------------------------------------

/**
 * Validate an hq_live_ bearer token by calling the Next.js agent auth endpoint.
 * Returns agent info if valid, null if invalid or unavailable.
 */
export async function validateAgentToken(
  token: string
): Promise<AgentAuthInfo | null> {
  if (!token || !token.startsWith("hq_live_")) {
    return null;
  }

  try {
    const res = await fetch(`${NEXTJS_URL}/api/v1/agent/auth`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      return null;
    }

    const data = await res.json();

    // The /api/v1/agent/auth endpoint returns agent info on success
    return {
      id: data.agent?.id ?? data.id,
      name: data.agent?.name ?? data.name ?? "unknown",
      owner: data.agent?.owner ?? data.owner ?? "",
      wallet: (data.agent?.wallet ?? data.wallet ?? "").toLowerCase(),
      roles: data.agent?.roles ?? data.roles ?? ["monitor"],
    };
  } catch (err) {
    console.error("[auth] Token validation failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fetch alert preferences
// ---------------------------------------------------------------------------

/**
 * Fetch the agent's stored alert preferences from the Next.js API.
 * Returns the preferences or null if unavailable (agent will use defaults).
 */
export async function fetchAlertPreferences(
  token: string
): Promise<AlertPreferencesResponse | null> {
  try {
    const res = await fetch(
      `${NEXTJS_URL}/api/v1/agent/alerts/preferences`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!res.ok) {
      return null;
    }

    return (await res.json()) as AlertPreferencesResponse;
  } catch (err) {
    console.error("[auth] Preferences fetch failed:", err);
    return null;
  }
}

/**
 * Convert a preferences API response to an AlertSubscription.
 */
export function preferencesToSubscription(
  prefs: AlertPreferencesResponse | null
): AlertSubscription {
  if (!prefs) {
    return {
      tokens: [],
      minNotionalUsd: 0,
      visibility: "all",
      side: "all",
      eventTypes: ["rfq.created", "rfq.filled"],
    };
  }

  return {
    tokens: prefs.tokens ?? [],
    minNotionalUsd: prefs.minNotionalUsd ?? 0,
    visibility: prefs.visibility ?? "all",
    side: prefs.side ?? "all",
    eventTypes: (prefs.eventTypes?.filter(
      (t) => t === "rfq.created" || t === "rfq.filled"
    ) ?? ["rfq.created", "rfq.filled"]) as AlertSubscription["eventTypes"],
  };
}
