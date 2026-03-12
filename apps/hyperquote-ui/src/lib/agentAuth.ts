/**
 * Agent Authentication & Authorization Middleware
 *
 * Provides Bearer token authentication for the /api/v1/agent/* gateway.
 *
 * Auth flow:
 *   1. Extract `Authorization: Bearer hq_live_...` header
 *   2. SHA-256 hash the raw key
 *   3. Lookup Agent record by hash
 *   4. Enforce status=ACTIVE, rate limits, and role checks
 *
 * Rate limiting uses an in-memory sliding window (same pattern as rfqRegistry).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentRole = "taker" | "maker" | "monitor";

export interface AgentAuthResult {
  id: string;
  name: string;
  owner: string;
  wallet: string;
  roles: AgentRole[];
  rateLimitPerMin: number;
  rateLimitPerHour: number;
}

interface RateLimitWindow {
  timestamps: number[];
}

// ---------------------------------------------------------------------------
// In-memory rate limiter (sliding window)
// ---------------------------------------------------------------------------

// agentId → { minute window timestamps, hour window timestamps }
const minuteWindows = new Map<string, RateLimitWindow>();
const hourWindows = new Map<string, RateLimitWindow>();

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

function checkRateLimit(
  agentId: string,
  perMin: number,
  perHour: number
): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();

  // --- Minute window ---
  let minEntry = minuteWindows.get(agentId);
  if (!minEntry) {
    minEntry = { timestamps: [] };
    minuteWindows.set(agentId, minEntry);
  }
  minEntry.timestamps = minEntry.timestamps.filter((t) => now - t < MINUTE_MS);
  if (minEntry.timestamps.length >= perMin) {
    const oldest = minEntry.timestamps[0];
    return { allowed: false, retryAfterMs: MINUTE_MS - (now - oldest) };
  }

  // --- Hour window ---
  let hourEntry = hourWindows.get(agentId);
  if (!hourEntry) {
    hourEntry = { timestamps: [] };
    hourWindows.set(agentId, hourEntry);
  }
  hourEntry.timestamps = hourEntry.timestamps.filter(
    (t) => now - t < HOUR_MS
  );
  if (hourEntry.timestamps.length >= perHour) {
    const oldest = hourEntry.timestamps[0];
    return { allowed: false, retryAfterMs: HOUR_MS - (now - oldest) };
  }

  // Record the request
  minEntry.timestamps.push(now);
  hourEntry.timestamps.push(now);

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// SHA-256 helper (Web Crypto API — available in Node 18+ and Edge Runtime)
// ---------------------------------------------------------------------------

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Core auth function
// ---------------------------------------------------------------------------

/**
 * Authenticate an incoming request using Bearer token.
 * Returns the authenticated agent or null (with appropriate HTTP response).
 */
export async function authenticateAgent(
  request: NextRequest
): Promise<
  | { agent: AgentAuthResult; error: null }
  | { agent: null; error: NextResponse }
> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      agent: null,
      error: NextResponse.json(
        { error: "Missing or invalid Authorization header. Use: Bearer hq_live_..." },
        { status: 401 }
      ),
    };
  }

  const rawKey = authHeader.slice(7).trim();
  if (!rawKey || !rawKey.startsWith("hq_live_")) {
    return {
      agent: null,
      error: NextResponse.json(
        { error: "Invalid API key format. Keys start with hq_live_" },
        { status: 401 }
      ),
    };
  }

  // Hash the key and look up
  const hash = await sha256(rawKey);

  let agent;
  try {
    agent = await prisma.agent.findUnique({
      where: { apiKeyHash: hash },
    });
  } catch (err) {
    console.error("[agentAuth] DB lookup failed:", err);
    return {
      agent: null,
      error: NextResponse.json(
        { error: "Authentication service unavailable" },
        { status: 503 }
      ),
    };
  }

  if (!agent) {
    return {
      agent: null,
      error: NextResponse.json(
        { error: "Invalid API key" },
        { status: 401 }
      ),
    };
  }

  if (agent.status !== "ACTIVE") {
    return {
      agent: null,
      error: NextResponse.json(
        { error: `Agent is ${agent.status.toLowerCase()}` },
        { status: 403 }
      ),
    };
  }

  // Rate limit check
  const rateCheck = checkRateLimit(
    agent.id,
    agent.rateLimitPerMin,
    agent.rateLimitPerHour
  );
  if (!rateCheck.allowed) {
    const retryAfter = Math.ceil((rateCheck.retryAfterMs ?? 1000) / 1000);
    return {
      agent: null,
      error: NextResponse.json(
        { error: `Rate limit exceeded. Retry after ${retryAfter}s` },
        {
          status: 429,
          headers: { "Retry-After": String(retryAfter) },
        }
      ),
    };
  }

  // Parse roles
  let roles: AgentRole[];
  try {
    roles = JSON.parse(agent.roles);
  } catch {
    roles = ["monitor"];
  }

  // Update lastSeenAt (fire-and-forget)
  prisma.agent
    .update({
      where: { id: agent.id },
      data: { lastSeenAt: new Date() },
    })
    .catch(() => {});

  return {
    agent: {
      id: agent.id,
      name: agent.name,
      owner: agent.owner,
      wallet: agent.wallet,
      roles,
      rateLimitPerMin: agent.rateLimitPerMin,
      rateLimitPerHour: agent.rateLimitPerHour,
    },
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Role enforcement
// ---------------------------------------------------------------------------

/**
 * Check if the agent has the required role.
 * Returns a 403 response if not authorized, null if OK.
 */
export function requireRole(
  agent: AgentAuthResult,
  role: AgentRole
): NextResponse | null {
  if (!agent.roles.includes(role)) {
    return NextResponse.json(
      {
        error: `Insufficient permissions. Required role: ${role}. Your roles: ${agent.roles.join(", ")}`,
      },
      { status: 403 }
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Activity logging
// ---------------------------------------------------------------------------

/**
 * Log an agent action (fire-and-forget).
 * Periodically triggers automatic cleanup of old logs.
 */
export function logActivity(
  agent: AgentAuthResult,
  action: string,
  metadata?: {
    rfqId?: string;
    ipAddress?: string;
    [key: string]: unknown;
  }
): void {
  const { rfqId, ipAddress, ...rest } = metadata ?? {};
  prisma.agentActivityLog
    .create({
      data: {
        agentId: agent.id,
        action,
        rfqId: rfqId ?? null,
        ipAddress: ipAddress ?? null,
        metadata: Object.keys(rest).length > 0 ? JSON.stringify(rest) : "{}",
      },
    })
    .then(() => {
      // Trigger periodic cleanup (fire-and-forget)
      maybeCleanupActivityLogs();
    })
    .catch((err) => {
      console.warn("[agentAuth] Activity log failed:", err);
    });
}

// ---------------------------------------------------------------------------
// Activity log retention — auto-prune old entries
// ---------------------------------------------------------------------------

const LOG_RETENTION_DAYS = 30;
const LOG_CLEANUP_INTERVAL_MS = 3_600_000; // Check every hour
let lastLogCleanup = 0;
let cleanupInProgress = false;

function maybeCleanupActivityLogs(): void {
  const now = Date.now();
  if (now - lastLogCleanup < LOG_CLEANUP_INTERVAL_MS) return;
  if (cleanupInProgress) return;

  cleanupInProgress = true;
  lastLogCleanup = now;

  const cutoff = new Date(now - LOG_RETENTION_DAYS * 86_400_000);

  prisma.agentActivityLog
    .deleteMany({
      where: { timestamp: { lt: cutoff } },
    })
    .then((result) => {
      if (result.count > 0) {
        console.log(
          `[agentAuth] Cleaned up ${result.count} activity logs older than ${LOG_RETENTION_DAYS} days`
        );
      }
    })
    .catch((err) => {
      console.warn("[agentAuth] Activity log cleanup failed:", err);
    })
    .finally(() => {
      cleanupInProgress = false;
    });
}

// ---------------------------------------------------------------------------
// API key generation helper (used by registration route)
// ---------------------------------------------------------------------------

/**
 * Generate a new API key with prefix and its SHA-256 hash.
 */
export async function generateApiKey(): Promise<{
  rawKey: string;
  hash: string;
  prefix: string;
}> {
  // Generate 32 random bytes → base64url → prefix with hq_live_
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const rawKey = `hq_live_${b64}`;
  const hash = await sha256(rawKey);
  const prefix = rawKey.slice(0, 16); // "hq_live_XXXXXXXX"

  return { rawKey, hash, prefix };
}

// ---------------------------------------------------------------------------
// Request helper — extract IP
// ---------------------------------------------------------------------------

export function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}
