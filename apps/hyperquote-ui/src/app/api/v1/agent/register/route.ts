/**
 * POST /api/v1/agent/register — Register a new API agent.
 *
 * Body:
 *   name          — Human-readable agent name (e.g. "Clawbot Taker")
 *   ownerWallet   — Owner wallet address (the human behind the agent)
 *   agentWallet   — Agent's signing wallet address
 *   roles         — Array of roles: ["taker"], ["maker"], ["monitor"], or combinations
 *   description   — Optional description
 *   signature     — EIP-191 signature of the registration message
 *   timestamp     — Unix seconds used in the signed message
 *
 * The owner must sign: "HyperQuote Agent: {name}:{agentWallet}:{timestamp}"
 * using their ownerWallet. This proves wallet ownership without on-chain tx.
 *
 * Returns:
 *   { agentId, apiKey, prefix, name, roles }
 *   The raw API key (hq_live_...) is shown ONCE. Store it securely.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateApiKey, getClientIp, type AgentRole } from "@/lib/agentAuth";
import { verifyMessage } from "ethers";

const VALID_ROLES: AgentRole[] = ["taker", "maker", "monitor"];
const MAX_AGENTS_PER_OWNER = 10;
const SIGNATURE_MAX_AGE_S = 300; // 5 minutes

// ---------------------------------------------------------------------------
// IP-based rate limiting for registration (anti-spam)
// ---------------------------------------------------------------------------

const REGISTER_PER_IP_PER_HOUR = 5;
const REGISTER_PER_IP_PER_DAY = 15;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

interface RateLimitWindow {
  timestamps: number[];
}

const ipHourWindows = new Map<string, RateLimitWindow>();
const ipDayWindows = new Map<string, RateLimitWindow>();

// Periodic cleanup to prevent memory growth (every 10 minutes)
let lastCleanup = Date.now();
const CLEANUP_INTERVAL_MS = 600_000;

function cleanupStaleEntries(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  for (const [ip, entry] of ipHourWindows) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < HOUR_MS);
    if (entry.timestamps.length === 0) ipHourWindows.delete(ip);
  }
  for (const [ip, entry] of ipDayWindows) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < DAY_MS);
    if (entry.timestamps.length === 0) ipDayWindows.delete(ip);
  }
}

function checkRegistrationRateLimit(ip: string): {
  allowed: boolean;
  retryAfterMs?: number;
} {
  const now = Date.now();

  // Run periodic cleanup
  cleanupStaleEntries();

  // --- Hour window ---
  let hourEntry = ipHourWindows.get(ip);
  if (!hourEntry) {
    hourEntry = { timestamps: [] };
    ipHourWindows.set(ip, hourEntry);
  }
  hourEntry.timestamps = hourEntry.timestamps.filter((t) => now - t < HOUR_MS);
  if (hourEntry.timestamps.length >= REGISTER_PER_IP_PER_HOUR) {
    const oldest = hourEntry.timestamps[0];
    return { allowed: false, retryAfterMs: HOUR_MS - (now - oldest) };
  }

  // --- Day window ---
  let dayEntry = ipDayWindows.get(ip);
  if (!dayEntry) {
    dayEntry = { timestamps: [] };
    ipDayWindows.set(ip, dayEntry);
  }
  dayEntry.timestamps = dayEntry.timestamps.filter((t) => now - t < DAY_MS);
  if (dayEntry.timestamps.length >= REGISTER_PER_IP_PER_DAY) {
    const oldest = dayEntry.timestamps[0];
    return { allowed: false, retryAfterMs: DAY_MS - (now - oldest) };
  }

  // Record
  hourEntry.timestamps.push(now);
  dayEntry.timestamps.push(now);

  return { allowed: true };
}

interface RegisterBody {
  name: string;
  ownerWallet: string;
  agentWallet: string;
  roles: string[];
  description?: string;
  signature: string;
  timestamp: number;
}

export async function POST(request: NextRequest) {
  // ── IP-based rate limiting (before any processing) ──

  const clientIp = getClientIp(request);
  const rateCheck = checkRegistrationRateLimit(clientIp);
  if (!rateCheck.allowed) {
    const retryAfter = Math.ceil((rateCheck.retryAfterMs ?? 3600_000) / 1000);
    return NextResponse.json(
      { error: `Registration rate limit exceeded. Try again in ${retryAfter}s.` },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      }
    );
  }

  let body: RegisterBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // ── Validate fields ──

  if (!body.name || typeof body.name !== "string" || body.name.length > 64) {
    return NextResponse.json(
      { error: "name is required (max 64 chars)" },
      { status: 400 }
    );
  }

  if (
    !body.ownerWallet ||
    !/^0x[0-9a-fA-F]{40}$/.test(body.ownerWallet)
  ) {
    return NextResponse.json(
      { error: "ownerWallet must be a valid 0x address" },
      { status: 400 }
    );
  }

  if (
    !body.agentWallet ||
    !/^0x[0-9a-fA-F]{40}$/.test(body.agentWallet)
  ) {
    return NextResponse.json(
      { error: "agentWallet must be a valid 0x address" },
      { status: 400 }
    );
  }

  if (
    !Array.isArray(body.roles) ||
    body.roles.length === 0 ||
    !body.roles.every((r) => VALID_ROLES.includes(r as AgentRole))
  ) {
    return NextResponse.json(
      { error: `roles must be a non-empty array of: ${VALID_ROLES.join(", ")}` },
      { status: 400 }
    );
  }

  if (!body.signature || typeof body.signature !== "string") {
    return NextResponse.json(
      { error: "signature is required" },
      { status: 400 }
    );
  }

  if (!body.timestamp || typeof body.timestamp !== "number") {
    return NextResponse.json(
      { error: "timestamp is required (unix seconds)" },
      { status: 400 }
    );
  }

  // ── Verify signature freshness ──

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - body.timestamp) > SIGNATURE_MAX_AGE_S) {
    return NextResponse.json(
      { error: `Signature expired. Timestamp must be within ${SIGNATURE_MAX_AGE_S}s of current time.` },
      { status: 400 }
    );
  }

  // ── Verify EIP-191 signature ──

  const message = `HyperQuote Agent: ${body.name}:${body.agentWallet.toLowerCase()}:${body.timestamp}`;

  let recoveredAddress: string;
  try {
    recoveredAddress = verifyMessage(message, body.signature).toLowerCase();
  } catch (err) {
    return NextResponse.json(
      { error: `Signature verification failed: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 400 }
    );
  }

  if (recoveredAddress !== body.ownerWallet.toLowerCase()) {
    return NextResponse.json(
      {
        error: "Signature does not match ownerWallet. Sign with the owner wallet.",
        expected: body.ownerWallet.toLowerCase(),
        recovered: recoveredAddress,
      },
      { status: 403 }
    );
  }

  // ── Enforce per-owner limit ──

  try {
    const existingCount = await prisma.agent.count({
      where: { owner: body.ownerWallet.toLowerCase() },
    });
    if (existingCount >= MAX_AGENTS_PER_OWNER) {
      return NextResponse.json(
        { error: `Maximum ${MAX_AGENTS_PER_OWNER} agents per owner wallet` },
        { status: 409 }
      );
    }
  } catch (err) {
    console.error("[agent/register] DB count failed:", err);
    return NextResponse.json(
      { error: "Service unavailable" },
      { status: 503 }
    );
  }

  // ── Generate API key and create agent ──

  const { rawKey, hash, prefix } = await generateApiKey();

  try {
    const agent = await prisma.agent.create({
      data: {
        name: body.name.trim(),
        owner: body.ownerWallet.toLowerCase(),
        wallet: body.agentWallet.toLowerCase(),
        apiKeyHash: hash,
        apiKeyPrefix: prefix,
        roles: JSON.stringify(body.roles),
        description: body.description?.slice(0, 256) ?? null,
      },
    });

    return NextResponse.json(
      {
        agentId: agent.id,
        apiKey: rawKey, // Shown ONCE — store securely
        prefix,
        name: agent.name,
        roles: body.roles,
        wallet: agent.wallet,
        owner: agent.owner,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[agent/register] Create failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
