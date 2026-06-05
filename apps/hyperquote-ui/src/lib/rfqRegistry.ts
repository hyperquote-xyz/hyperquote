/**
 * RFQ Registry — Durable server-side state for tracking RFQs and quotes.
 *
 * PostgreSQL (via Prisma) is the single source of truth.
 * In-memory Maps are kept as a hot cache for SSE event delivery only.
 *
 * All writes go to Postgres first (awaited). If Postgres fails, the
 * operation fails. Memory is populated AFTER a successful DB write.
 * All reads go to Postgres.
 *
 * What stays in-memory (volatile, acceptable to lose on restart):
 *   - Rate limiting Maps
 *   - SSE subscriber Sets
 *   - Hot cache for SSE event data (populated from DB writes)
 */

import { RFQRequestJSON, RFQQuoteJSON, RFQVisibility } from "@/types";
import { prisma } from "@/lib/db";
import {
  notifyRfqCreated,
  notifyRfqFilled,
  notifyRfqExpiredOrKilled,
} from "@/lib/telegram";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PUBLIC_PER_WALLET = 3;
const MAX_PRIVATE_PER_WALLET = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const EXPIRY_SCAN_INTERVAL_MS = 5_000;
const MAX_QUOTES_PER_RFQ = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  timestamps: number[];
}

export interface RegisterResult {
  allowed: boolean;
  reason?: string;
  shareToken?: string;
  activeCount: { public: number; private: number };
}

export type FeedRfqStatus = "OPEN" | "QUOTED" | "FILLED" | "EXPIRED" | "KILLED";

export type FeedEventType =
  | "rfq.created"
  | "rfq.quoted"
  | "rfq.filled"
  | "rfq.cancelled"
  | "rfq.expired";

export interface FeedEvent {
  type: FeedEventType;
  rfqId: string;
  data: RFQRequestJSON;
  status: FeedRfqStatus;
  quoteCount?: number;
  fillTxHash?: string;
  timestamp: number;
}

export interface InternalFeedEvent extends FeedEvent {
  visibility: RFQVisibility;
  allowedMakers?: string[];
}

// ---------------------------------------------------------------------------
// Module-level singletons — volatile caches and subscriber sets
// ---------------------------------------------------------------------------

const rateLimits = new Map<string, RateLimitEntry>();

// SSE subscribers
type SSEWriter = { write: (data: string) => void; close: () => void };
const sseSubscribers = new Set<SSEWriter>();
const feedSubscribers = new Set<SSEWriter>();
const internalSubscribers = new Set<SSEWriter>();

// Hot cache for SSE event data (populated from DB writes, NOT used for reads)
const rfqCache = new Map<string, RFQRequestJSON>(); // rfqId → rfqData
const visibilityCache = new Map<string, RFQVisibility>(); // rfqId → visibility
const allowedMakersCache = new Map<string, string[] | undefined>(); // rfqId → allowedMakers

// ---------------------------------------------------------------------------
// DB → Type mapping helpers
// ---------------------------------------------------------------------------

function feedRfqToRequestJSON(row: {
  id: string; kind: number; taker: string; tokenInJson: string; tokenOutJson: string;
  amountIn: string | null; amountOut: string | null; expiry: number;
  createdAt: Date | number; visibility: string; allowedMakers: string | null;
}): RFQRequestJSON {
  return {
    id: row.id,
    kind: row.kind,
    taker: row.taker,
    tokenIn: JSON.parse(row.tokenInJson),
    tokenOut: JSON.parse(row.tokenOutJson),
    amountIn: row.amountIn ?? undefined,
    amountOut: row.amountOut ?? undefined,
    expiry: row.expiry,
    createdAt: row.createdAt instanceof Date
      ? Math.floor(row.createdAt.getTime() / 1000)
      : row.createdAt,
    visibility: row.visibility as RFQVisibility,
    allowedMakers: row.allowedMakers ? JSON.parse(row.allowedMakers) : undefined,
  };
}

function feedQuoteToJSON(row: {
  kind: number; maker: string; taker: string; tokenIn: string; tokenOut: string;
  amountIn: string; amountOut: string; expiry: number; nonce: string;
  requestId: string; signature: string; createdAt: Date | number;
}): RFQQuoteJSON {
  return {
    kind: row.kind,
    maker: row.maker,
    taker: row.taker,
    tokenIn: row.tokenIn,
    tokenOut: row.tokenOut,
    amountIn: row.amountIn,
    amountOut: row.amountOut,
    expiry: row.expiry,
    nonce: row.nonce,
    requestId: row.requestId,
    signature: row.signature,
    createdAt: row.createdAt instanceof Date
      ? Math.floor(row.createdAt.getTime() / 1000)
      : row.createdAt,
  };
}

function safeParseJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Rate limiting — sliding window per IP+wallet (in-memory, volatile)
// ---------------------------------------------------------------------------

function checkRateLimit(
  ip: string,
  wallet: string
): { allowed: boolean; retryAfterMs?: number } {
  const key = `${ip}|${wallet}`;
  const now = Date.now();
  const entry = rateLimits.get(key);

  if (!entry) {
    rateLimits.set(key, { timestamps: [now] });
    return { allowed: true };
  }

  entry.timestamps = entry.timestamps.filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );

  if (entry.timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    const oldestInWindow = entry.timestamps[0];
    const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - oldestInWindow);
    return { allowed: false, retryAfterMs };
  }

  entry.timestamps.push(now);
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Active count — DB-backed
// ---------------------------------------------------------------------------

async function countActive(wallet: string): Promise<{ public: number; private: number }> {
  const now = Math.floor(Date.now() / 1000);
  console.log("[countActive] calling prisma.feedRfq.count() with now=", now, "wallet=", wallet.slice(0, 10));
  const [pub, priv] = await Promise.all([
    prisma.feedRfq.count({
      where: { taker: wallet, status: { in: ["OPEN", "QUOTED"] }, visibility: "public", expiry: { gt: now } },
    }),
    prisma.feedRfq.count({
      where: { taker: wallet, status: { in: ["OPEN", "QUOTED"] }, visibility: "private", expiry: { gt: now } },
    }),
  ]);
  console.log("[countActive] result:", { public: pub, private: priv });
  return { public: pub, private: priv };
}

// ---------------------------------------------------------------------------
// SSE subscriber management
// ---------------------------------------------------------------------------

export function addFeedSubscriber(writer: SSEWriter): () => void {
  feedSubscribers.add(writer);
  return () => { feedSubscribers.delete(writer); };
}

export function addInternalSubscriber(writer: SSEWriter): () => void {
  internalSubscribers.add(writer);
  return () => { internalSubscribers.delete(writer); };
}

export function addSSESubscriber(writer: SSEWriter): () => void {
  sseSubscribers.add(writer);
  return () => { sseSubscribers.delete(writer); };
}

function broadcastFeedEvent(event: FeedEvent): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const sub of feedSubscribers) {
    try { sub.write(payload); } catch { feedSubscribers.delete(sub); }
  }
}

function broadcastInternalEvent(event: InternalFeedEvent): void {
  if (internalSubscribers.size === 0) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const sub of internalSubscribers) {
    try { sub.write(payload); } catch { internalSubscribers.delete(sub); }
  }
}

function broadcastSSE(event: object): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const sub of sseSubscribers) {
    try { sub.write(payload); } catch { sseSubscribers.delete(sub); }
  }
}

// ---------------------------------------------------------------------------
// Cache helpers — populate after DB writes for SSE event construction
// ---------------------------------------------------------------------------

function cacheRfq(rfqId: string, data: RFQRequestJSON, visibility: RFQVisibility, allowedMakers?: string[]): void {
  rfqCache.set(rfqId, data);
  visibilityCache.set(rfqId, visibility);
  allowedMakersCache.set(rfqId, allowedMakers);
}

function getCachedRfq(rfqId: string): { data: RFQRequestJSON; visibility: RFQVisibility; allowedMakers?: string[] } | null {
  const data = rfqCache.get(rfqId);
  if (!data) return null;
  return { data, visibility: visibilityCache.get(rfqId) ?? "public", allowedMakers: allowedMakersCache.get(rfqId) };
}

function evictCache(rfqId: string): void {
  rfqCache.delete(rfqId);
  visibilityCache.delete(rfqId);
  allowedMakersCache.delete(rfqId);
}

// ---------------------------------------------------------------------------
// Expiry scanner — DB-first, emits SSE events
// ---------------------------------------------------------------------------

let expiryTimerStarted = false;

export function startExpiryScanner(): void {
  if (expiryTimerStarted) return;
  expiryTimerStarted = true;

  setInterval(async () => {
    const now = Math.floor(Date.now() / 1000);

    try {
      // Find expired RFQs from DB (for SSE event emission)
      const expired = await prisma.feedRfq.findMany({
        where: {
          status: { in: ["OPEN", "QUOTED"] },
          expiry: { lte: now },
        },
        select: {
          id: true, taker: true, visibility: true, allowedMakers: true,
          tokenInJson: true, tokenOutJson: true, kind: true,
          amountIn: true, amountOut: true, expiry: true, createdAt: true,
        },
      });

      if (expired.length === 0) return;

      // Emit SSE events for each expired RFQ
      for (const row of expired) {
        const rfqData = feedRfqToRequestJSON(row);
        const vis = row.visibility as RFQVisibility;
        const makers = row.allowedMakers ? (safeParseJson(row.allowedMakers) as string[]) : undefined;

        broadcastInternalEvent({
          type: "rfq.expired",
          rfqId: row.id,
          data: rfqData,
          status: "EXPIRED",
          timestamp: now,
          visibility: vis,
          allowedMakers: makers,
        });

        if (vis === "public") {
          broadcastFeedEvent({
            type: "rfq.expired",
            rfqId: row.id,
            data: rfqData,
            status: "EXPIRED",
            timestamp: now,
          });
          notifyRfqExpiredOrKilled("expired", {
            id: row.id,
            tokenIn: rfqData.tokenIn,
            tokenOut: rfqData.tokenOut,
          });
        }

        evictCache(row.id);
      }

      // Bulk-update status
      await prisma.feedRfq.updateMany({
        where: {
          status: { in: ["OPEN", "QUOTED"] },
          expiry: { lte: now },
        },
        data: { status: "EXPIRED" },
      });
    } catch (err) {
      console.warn("[rfqRegistry] Expiry scanner error:", err);
    }
  }, EXPIRY_SCAN_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Public API — All async, DB-first
// ---------------------------------------------------------------------------

/**
 * Register a new RFQ. Writes to Postgres first, then caches for SSE.
 */
export async function registerRFQ(params: {
  wallet: string;
  visibility: RFQVisibility;
  expiry: number;
  rfqData: RFQRequestJSON;
  ip: string;
}): Promise<RegisterResult> {
  const wallet = params.wallet.toLowerCase();

  console.log("[registerRFQ] ENTER", { wallet: wallet.slice(0, 10), visibility: params.visibility, rfqId: params.rfqData?.id?.slice(0, 8) });

  // Rate limit check (in-memory, fast)
  const rateCheck = checkRateLimit(params.ip, wallet);
  if (!rateCheck.allowed) {
    console.log("[registerRFQ] rate-limited");
    const active = await countActive(wallet);
    return {
      allowed: false,
      reason: `Rate limit exceeded. Try again in ${Math.ceil((rateCheck.retryAfterMs ?? 0) / 1000)}s`,
      activeCount: active,
    };
  }

  console.log("[registerRFQ] rate limit passed, calling countActive...");
  // Active count check (DB-backed)
  let active;
  try {
    active = await countActive(wallet);
    console.log("[registerRFQ] countActive returned:", active);
  } catch (err) {
    console.error("[registerRFQ] countActive THREW:", err instanceof Error ? err.message : err);
    console.error("[registerRFQ] countActive stack:", err instanceof Error ? err.stack : "no stack");
    // Return gracefully — don't block on count failure
    active = { public: 0, private: 0 };
  }
  if (params.visibility === "public" && active.public >= MAX_PUBLIC_PER_WALLET) {
    return {
      allowed: false,
      reason: `Maximum ${MAX_PUBLIC_PER_WALLET} active public RFQs reached. Wait for one to expire or cancel.`,
      activeCount: active,
    };
  }
  if (params.visibility === "private" && active.private >= MAX_PRIVATE_PER_WALLET) {
    return {
      allowed: false,
      reason: `Maximum ${MAX_PRIVATE_PER_WALLET} active private RFQs reached. Wait for one to expire.`,
      activeCount: active,
    };
  }

  // Generate share token
  const shareToken = crypto.randomUUID();
  const rfqData = params.rfqData;

  // Write to Postgres FIRST — if this fails, the RFQ does not exist
  console.log("[registerRFQ] about to call prisma.feedRfq.create()...");
  try {
    await prisma.feedRfq.create({
      data: {
        id: rfqData.id,
        taker: wallet,
        tokenIn: rfqData.tokenIn.address.toLowerCase(),
        tokenOut: rfqData.tokenOut.address.toLowerCase(),
        tokenInJson: JSON.stringify(rfqData.tokenIn),
        tokenOutJson: JSON.stringify(rfqData.tokenOut),
        kind: rfqData.kind,
        amountIn: rfqData.amountIn ?? null,
        amountOut: rfqData.amountOut ?? null,
        expiry: params.expiry,
        status: "OPEN",
        visibility: params.visibility,
        shareToken,
        allowedMakers: rfqData.allowedMakers
          ? JSON.stringify(rfqData.allowedMakers.map((a) => a.toLowerCase()))
          : null,
      },
    });
    console.log("[registerRFQ] prisma.feedRfq.create() SUCCEEDED");
  } catch (err) {
    console.error("[registerRFQ] prisma.feedRfq.create() FAILED");
    console.error("[registerRFQ] error type:", err?.constructor?.name);
    console.error("[registerRFQ] error message:", err instanceof Error ? err.message : String(err));
    console.error("[registerRFQ] error code:", (err as any)?.code);
    console.error("[registerRFQ] error meta:", JSON.stringify((err as any)?.meta));
    console.error("[registerRFQ] full error:", err);
    return {
      allowed: false,
      reason: "Failed to create RFQ: " + (err instanceof Error ? err.message : String(err)),
      activeCount: active,
    };
  }

  // Cache for SSE event delivery
  cacheRfq(
    rfqData.id,
    rfqData,
    params.visibility,
    rfqData.allowedMakers?.map((a) => a.toLowerCase()),
  );

  const now = Math.floor(Date.now() / 1000);

  // Broadcast to legacy SSE subscribers if public
  if (params.visibility === "public") {
    broadcastSSE({ type: "rfq", data: rfqData });
    broadcastFeedEvent({
      type: "rfq.created",
      rfqId: rfqData.id,
      data: rfqData,
      status: "OPEN",
      timestamp: now,
    });
    notifyRfqCreated({
      id: rfqData.id,
      tokenIn: rfqData.tokenIn,
      tokenOut: rfqData.tokenOut,
      amountIn: rfqData.amountIn,
      amountOut: rfqData.amountOut,
      kind: rfqData.kind,
      expiry: rfqData.expiry,
      taker: wallet,
    });
  }

  // Internal event — all RFQs
  broadcastInternalEvent({
    type: "rfq.created",
    rfqId: rfqData.id,
    data: rfqData,
    status: "OPEN",
    timestamp: now,
    visibility: params.visibility,
    allowedMakers: rfqData.allowedMakers?.map((a) => a.toLowerCase()),
  });

  const newCount = await countActive(wallet);
  return { allowed: true, shareToken, activeCount: newCount };
}

/**
 * Retrieve a private RFQ by its share token (DB-backed).
 */
export async function getRFQByShareToken(token: string): Promise<RFQRequestJSON | null> {
  const row = await prisma.feedRfq.findUnique({ where: { shareToken: token } });
  if (!row) return null;

  const now = Math.floor(Date.now() / 1000);
  if (row.expiry <= now && !["FILLED", "KILLED", "EXPIRED"].includes(row.status)) return null;

  return feedRfqToRequestJSON(row);
}

/**
 * Get active RFQ count for a wallet (DB-backed).
 */
export async function getActiveCount(wallet: string): Promise<{ public: number; private: number }> {
  return countActive(wallet.toLowerCase());
}

/**
 * Retrieve an RFQ by its request ID (DB-backed, includes quotes).
 */
export async function getRFQById(
  rfqId: string,
  shareToken?: string
): Promise<{ rfq: RFQRequestJSON; quotes: RFQQuoteJSON[] } | null> {
  const row = await prisma.feedRfq.findUnique({
    where: { id: rfqId },
    include: { quotes: true },
  });
  if (!row) return null;

  // Private RFQs require the share token
  if (row.visibility === "private") {
    if (!shareToken || shareToken !== row.shareToken) return null;
  }

  const rfq = feedRfqToRequestJSON(row);
  const quotes = (row.quotes ?? []).map(feedQuoteToJSON);
  return { rfq, quotes };
}

/**
 * Get the wallet that created an RFQ (DB-backed).
 */
export async function getRFQOwner(rfqId: string): Promise<string | null> {
  const row = await prisma.feedRfq.findUnique({
    where: { id: rfqId },
    select: { taker: true },
  });
  return row?.taker ?? null;
}

/**
 * List all active public RFQs (DB-backed).
 */
export async function listPublicRFQs(): Promise<RFQRequestJSON[]> {
  const now = Math.floor(Date.now() / 1000);
  const rows = await prisma.feedRfq.findMany({
    where: {
      visibility: "public",
      status: { in: ["OPEN", "QUOTED"] },
      expiry: { gt: now },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map(feedRfqToRequestJSON);
}

/**
 * Submit a signed quote for an RFQ (DB-first).
 */
export async function submitQuote(
  rfqId: string,
  quote: RFQQuoteJSON,
  shareToken?: string
): Promise<{ accepted: boolean; reason?: string }> {
  // Look up RFQ from DB
  const rfqRow = await prisma.feedRfq.findUnique({ where: { id: rfqId } });
  if (!rfqRow) return { accepted: false, reason: "RFQ not found" };

  const now = Math.floor(Date.now() / 1000);
  if (rfqRow.expiry <= now) return { accepted: false, reason: "RFQ expired" };
  if (["FILLED", "KILLED", "EXPIRED"].includes(rfqRow.status)) {
    return { accepted: false, reason: `RFQ is ${rfqRow.status.toLowerCase()}` };
  }

  // Private RFQs require share token
  if (rfqRow.visibility === "private") {
    if (!shareToken || shareToken !== rfqRow.shareToken) {
      return { accepted: false, reason: "Invalid share token for private RFQ" };
    }
  }

  // Enforce allowedMakers list
  if (rfqRow.allowedMakers) {
    const allowed = safeParseJson(rfqRow.allowedMakers) as string[] | null;
    if (allowed?.length) {
      const makerLower = quote.maker.toLowerCase();
      if (!allowed.some((addr) => addr === makerLower)) {
        return { accepted: false, reason: "Maker not in allowed list" };
      }
    }
  }

  // Validate requestId
  if (quote.requestId !== rfqId) {
    return { accepted: false, reason: "Quote requestId does not match" };
  }

  // Structural checks
  if (!quote.signature || quote.signature.length < 130) {
    return { accepted: false, reason: "Signature missing or malformed" };
  }
  if (!quote.maker || !/^0x[0-9a-fA-F]{40}$/.test(quote.maker)) {
    return { accepted: false, reason: "Invalid maker address" };
  }

  // Check max quotes
  const existingCount = await prisma.feedQuote.count({ where: { rfqId } });
  // Allow if under limit, or if this is a replacement (same maker)
  if (existingCount >= MAX_QUOTES_PER_RFQ) {
    const existing = await prisma.feedQuote.findUnique({
      where: { rfqId_maker: { rfqId, maker: quote.maker.toLowerCase() } },
    });
    if (!existing) {
      return { accepted: false, reason: "Maximum quotes for this RFQ reached" };
    }
  }

  // Persist to DB — upsert (one quote per maker per RFQ)
  const makerLower = quote.maker.toLowerCase();
  try {
    await prisma.feedQuote.upsert({
      where: { rfqId_maker: { rfqId, maker: makerLower } },
      create: {
        rfqId,
        maker: makerLower,
        taker: quote.taker,
        kind: quote.kind,
        tokenIn: quote.tokenIn,
        tokenOut: quote.tokenOut,
        amountIn: quote.amountIn,
        amountOut: quote.amountOut,
        expiry: quote.expiry,
        nonce: quote.nonce,
        signature: quote.signature,
        requestId: quote.requestId,
      },
      update: {
        taker: quote.taker,
        kind: quote.kind,
        amountIn: quote.amountIn,
        amountOut: quote.amountOut,
        expiry: quote.expiry,
        nonce: quote.nonce,
        signature: quote.signature,
      },
    });

    // Update quote count on FeedRfq
    const newCount = await prisma.feedQuote.count({ where: { rfqId } });
    await prisma.feedRfq.update({
      where: { id: rfqId },
      data: { quoteCount: newCount, status: "QUOTED" },
    });
  } catch (err) {
    console.error("[rfqRegistry] Failed to persist quote:", err);
    return { accepted: false, reason: "Failed to persist quote" };
  }

  // SSE event delivery — use cache or reconstruct from DB row
  const cached = getCachedRfq(rfqId);
  const rfqData = cached?.data ?? feedRfqToRequestJSON(rfqRow);
  const vis = (cached?.visibility ?? rfqRow.visibility) as RFQVisibility;
  const makers = cached?.allowedMakers ?? (rfqRow.allowedMakers ? (safeParseJson(rfqRow.allowedMakers) as string[]) : undefined);
  const quoteCount = (await prisma.feedQuote.count({ where: { rfqId } }));

  if (vis === "public") {
    broadcastSSE({ type: "quote", rfqId, data: quote });
    broadcastFeedEvent({
      type: "rfq.quoted",
      rfqId,
      data: rfqData,
      status: "QUOTED",
      quoteCount,
      timestamp: now,
    });
  }

  broadcastInternalEvent({
    type: "rfq.quoted",
    rfqId,
    data: rfqData,
    status: "QUOTED",
    quoteCount,
    timestamp: now,
    visibility: vis,
    allowedMakers: makers,
  });

  return { accepted: true };
}

// ---------------------------------------------------------------------------
// Lifecycle mutations — Fill + Cancel (already async, now fully DB-backed)
// ---------------------------------------------------------------------------

/**
 * Mark an RFQ as filled. Updates Postgres, emits SSE.
 */
export async function markRfqFilled(
  rfqId: string,
  txHash: string
): Promise<boolean> {
  // Load from cache or DB for SSE event
  let cached = getCachedRfq(rfqId);
  if (!cached) {
    const row = await prisma.feedRfq.findUnique({ where: { id: rfqId } });
    if (row) {
      cached = {
        data: feedRfqToRequestJSON(row),
        visibility: row.visibility as RFQVisibility,
        allowedMakers: row.allowedMakers ? (safeParseJson(row.allowedMakers) as string[]) : undefined,
      };
    }
  }

  // Update Postgres
  await prisma.feedRfq.update({
    where: { id: rfqId },
    data: { status: "FILLED", fillTxHash: txHash },
  });

  const now = Math.floor(Date.now() / 1000);

  if (cached) {
    if (cached.visibility === "public") {
      broadcastFeedEvent({
        type: "rfq.filled",
        rfqId,
        data: cached.data,
        status: "FILLED",
        fillTxHash: txHash,
        timestamp: now,
      });
      notifyRfqFilled({
        id: rfqId,
        tokenIn: cached.data.tokenIn,
        tokenOut: cached.data.tokenOut,
        amountIn: cached.data.amountIn,
        amountOut: cached.data.amountOut,
        fillTxHash: txHash,
      });
    }

    broadcastInternalEvent({
      type: "rfq.filled",
      rfqId,
      data: cached.data,
      status: "FILLED",
      fillTxHash: txHash,
      timestamp: now,
      visibility: cached.visibility,
      allowedMakers: cached.allowedMakers,
    });
  }

  evictCache(rfqId);
  return true;
}

/**
 * Mark an RFQ as cancelled/killed. Updates Postgres, emits SSE.
 */
export async function markRfqCancelled(rfqId: string): Promise<boolean> {
  // Load from cache or DB for SSE event
  let cached = getCachedRfq(rfqId);
  if (!cached) {
    const row = await prisma.feedRfq.findUnique({ where: { id: rfqId } });
    if (row) {
      cached = {
        data: feedRfqToRequestJSON(row),
        visibility: row.visibility as RFQVisibility,
        allowedMakers: row.allowedMakers ? (safeParseJson(row.allowedMakers) as string[]) : undefined,
      };
    }
  }

  // Update Postgres
  await prisma.feedRfq.update({
    where: { id: rfqId },
    data: { status: "KILLED" },
  });

  const now = Math.floor(Date.now() / 1000);

  if (cached) {
    broadcastInternalEvent({
      type: "rfq.cancelled",
      rfqId,
      data: cached.data,
      status: "KILLED",
      timestamp: now,
      visibility: cached.visibility,
      allowedMakers: cached.allowedMakers,
    });

    if (cached.visibility === "public") {
      broadcastFeedEvent({
        type: "rfq.cancelled",
        rfqId,
        data: cached.data,
        status: "KILLED",
        timestamp: now,
      });
      notifyRfqExpiredOrKilled("killed", {
        id: rfqId,
        tokenIn: cached.data.tokenIn,
        tokenOut: cached.data.tokenOut,
      });
    }
  }

  evictCache(rfqId);
  return true;
}
