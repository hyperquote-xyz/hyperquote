/**
 * RFQ Registry — In-memory server-side state for tracking active RFQs,
 * enforcing per-wallet limits, rate limiting, and share tokens.
 *
 * Runs in Node.js (used by API routes), NOT in browser code.
 * Data is volatile — lost on server restart. Acceptable for dev/demo.
 *
 * Extended with:
 *   - Feed event system (rfq.created/quoted/filled/cancelled/expired)
 *   - Prisma persistence for FeedRfq (survives restart)
 *   - Expiry scanner (detects + emits expired events)
 *   - Telegram broadcast integration
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
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // max 10 requests per minute per key
const EXPIRY_SCAN_INTERVAL_MS = 5_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RFQEntry {
  id: string;
  wallet: string; // lowercase
  visibility: RFQVisibility;
  expiry: number; // unix seconds
  shareToken: string;
  rfqData: RFQRequestJSON;
  createdAt: number; // unix seconds
}

interface RateLimitEntry {
  timestamps: number[]; // sliding window of request timestamps (ms)
}

export interface RegisterResult {
  allowed: boolean;
  reason?: string;
  shareToken?: string;
  activeCount: { public: number; private: number };
}

// Feed event types
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

// ---------------------------------------------------------------------------
// Module-level singletons (same pattern as contract-status route)
// ---------------------------------------------------------------------------

const rfqStore = new Map<string, RFQEntry>(); // shareToken → entry
const rfqById = new Map<string, string>(); // rfqId → shareToken (reverse index)
const walletIndex = new Map<string, Set<string>>(); // wallet → Set<shareToken>
const rateLimits = new Map<string, RateLimitEntry>(); // "ip|wallet" → entry

// Quote storage: rfqId → RFQQuoteJSON[]
const quoteStore = new Map<string, RFQQuoteJSON[]>();

// SSE subscribers: Set of writable controllers for the public feed stream (legacy)
type SSEWriter = { write: (data: string) => void; close: () => void };
const sseSubscribers = new Set<SSEWriter>();

// Feed SSE subscribers (new — used by /api/v1/feed/stream)
const feedSubscribers = new Set<SSEWriter>();

// Internal SSE subscribers — receives ALL events (public + private) with metadata
// Used by the alert-stream service to build filtered WebSocket alerts
const internalSubscribers = new Set<SSEWriter>();

// ---------------------------------------------------------------------------
// Cleanup — removes expired entries. Called on every public function.
// NOTE: The expiry scanner (startExpiryScanner) handles emitting events
// and updating Prisma. This cleanup is for the in-memory store only and
// does NOT emit events (to avoid duplicates with the scanner).
// ---------------------------------------------------------------------------

function cleanup(): void {
  const now = Math.floor(Date.now() / 1000);

  for (const [token, entry] of rfqStore) {
    if (entry.expiry <= now) {
      rfqStore.delete(token);
      rfqById.delete(entry.id);
      quoteStore.delete(entry.id);

      // Remove from wallet index
      const tokens = walletIndex.get(entry.wallet);
      if (tokens) {
        tokens.delete(token);
        if (tokens.size === 0) walletIndex.delete(entry.wallet);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Rate limiting — sliding window per IP+wallet
// ---------------------------------------------------------------------------

function checkRateLimit(
  ip: string,
  wallet: string
): { allowed: boolean; retryAfterMs?: number } {
  const key = `${ip}|${wallet.toLowerCase()}`;
  const now = Date.now();
  const entry = rateLimits.get(key);

  if (!entry) {
    rateLimits.set(key, { timestamps: [now] });
    return { allowed: true };
  }

  // Remove timestamps outside the window
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
// Active count helper
// ---------------------------------------------------------------------------

function countActive(wallet: string): { public: number; private: number } {
  const tokens = walletIndex.get(wallet.toLowerCase());
  if (!tokens) return { public: 0, private: 0 };

  let pub = 0;
  let priv = 0;
  for (const token of tokens) {
    const entry = rfqStore.get(token);
    if (entry) {
      if (entry.visibility === "public") pub++;
      else priv++;
    }
  }
  return { public: pub, private: priv };
}

// ---------------------------------------------------------------------------
// Internal feed event type — extends FeedEvent with private RFQ metadata
// ---------------------------------------------------------------------------

export interface InternalFeedEvent extends FeedEvent {
  visibility: RFQVisibility;
  allowedMakers?: string[];
}

// ---------------------------------------------------------------------------
// Feed SSE subscriber management
// ---------------------------------------------------------------------------

/**
 * Register a feed SSE subscriber. Returns an unsubscribe function.
 */
export function addFeedSubscriber(writer: SSEWriter): () => void {
  feedSubscribers.add(writer);
  return () => {
    feedSubscribers.delete(writer);
  };
}

/**
 * Register an internal SSE subscriber (for alert-stream service).
 * Receives ALL events (public + private) with visibility and allowedMakers metadata.
 * Returns an unsubscribe function.
 */
export function addInternalSubscriber(writer: SSEWriter): () => void {
  internalSubscribers.add(writer);
  return () => {
    internalSubscribers.delete(writer);
  };
}

/**
 * Broadcast a feed event to all feed SSE subscribers.
 */
function broadcastFeedEvent(event: FeedEvent): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const sub of feedSubscribers) {
    try {
      sub.write(payload);
    } catch {
      feedSubscribers.delete(sub);
    }
  }
}

/**
 * Broadcast an internal event to all internal SSE subscribers.
 * Called UNCONDITIONALLY for all RFQs (public + private) with full metadata.
 */
function broadcastInternalEvent(event: InternalFeedEvent): void {
  if (internalSubscribers.size === 0) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const sub of internalSubscribers) {
    try {
      sub.write(payload);
    } catch {
      internalSubscribers.delete(sub);
    }
  }
}

// ---------------------------------------------------------------------------
// Expiry scanner — detects expired RFQs, emits events, updates Prisma
// ---------------------------------------------------------------------------

let expiryTimerStarted = false;

/**
 * Start the expiry scanner. Safe to call multiple times — only starts once.
 */
export function startExpiryScanner(): void {
  if (expiryTimerStarted) return;
  expiryTimerStarted = true;

  setInterval(async () => {
    const now = Math.floor(Date.now() / 1000);

    // Scan in-memory store for expired entries
    for (const [token, entry] of rfqStore) {
      if (entry.expiry <= now) {
        // Internal event — broadcast unconditionally for ALL expirations
        broadcastInternalEvent({
          type: "rfq.expired",
          rfqId: entry.id,
          data: entry.rfqData,
          status: "EXPIRED",
          timestamp: now,
          visibility: entry.visibility,
          allowedMakers: entry.rfqData.allowedMakers?.map((a) => a.toLowerCase()),
        });

        // Emit public feed expiry event BEFORE removing
        if (entry.visibility === "public") {
          broadcastFeedEvent({
            type: "rfq.expired",
            rfqId: entry.id,
            data: entry.rfqData,
            status: "EXPIRED",
            timestamp: now,
          });

          notifyRfqExpiredOrKilled("expired", {
            id: entry.id,
            tokenIn: entry.rfqData.tokenIn,
            tokenOut: entry.rfqData.tokenOut,
          });
        }

        // Remove from in-memory stores
        rfqStore.delete(token);
        rfqById.delete(entry.id);
        quoteStore.delete(entry.id);
        const tokens = walletIndex.get(entry.wallet);
        if (tokens) {
          tokens.delete(token);
          if (tokens.size === 0) walletIndex.delete(entry.wallet);
        }
      }
    }

    // Bulk-update Prisma: mark any OPEN/QUOTED entries past expiry
    try {
      await prisma.feedRfq.updateMany({
        where: {
          status: { in: ["OPEN", "QUOTED"] },
          expiry: { lte: now },
        },
        data: { status: "EXPIRED" },
      });
    } catch {
      // Non-critical — Prisma may be unavailable
    }
  }, EXPIRY_SCAN_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register a new RFQ. Enforces rate limits and per-wallet active limits.
 */
export function registerRFQ(params: {
  wallet: string;
  visibility: RFQVisibility;
  expiry: number;
  rfqData: RFQRequestJSON;
  ip: string;
}): RegisterResult {
  cleanup();

  const wallet = params.wallet.toLowerCase();

  // Rate limit check
  const rateCheck = checkRateLimit(params.ip, wallet);
  if (!rateCheck.allowed) {
    return {
      allowed: false,
      reason: `Rate limit exceeded. Try again in ${Math.ceil((rateCheck.retryAfterMs ?? 0) / 1000)}s`,
      activeCount: countActive(wallet),
    };
  }

  // Active count check
  const active = countActive(wallet);
  if (
    params.visibility === "public" &&
    active.public >= MAX_PUBLIC_PER_WALLET
  ) {
    return {
      allowed: false,
      reason: `Maximum ${MAX_PUBLIC_PER_WALLET} active public RFQs reached. Wait for one to expire or cancel.`,
      activeCount: active,
    };
  }
  if (
    params.visibility === "private" &&
    active.private >= MAX_PRIVATE_PER_WALLET
  ) {
    return {
      allowed: false,
      reason: `Maximum ${MAX_PRIVATE_PER_WALLET} active private RFQs reached. Wait for one to expire.`,
      activeCount: active,
    };
  }

  // Generate share token and store
  const shareToken = crypto.randomUUID();

  const entry: RFQEntry = {
    id: params.rfqData.id,
    wallet,
    visibility: params.visibility,
    expiry: params.expiry,
    shareToken,
    rfqData: params.rfqData,
    createdAt: Math.floor(Date.now() / 1000),
  };

  rfqStore.set(shareToken, entry);
  rfqById.set(entry.id, shareToken);

  // Update wallet index
  let tokens = walletIndex.get(wallet);
  if (!tokens) {
    tokens = new Set();
    walletIndex.set(wallet, tokens);
  }
  tokens.add(shareToken);

  // Broadcast to legacy SSE subscribers if public
  if (params.visibility === "public") {
    broadcastSSE({ type: "rfq", data: params.rfqData });

    // Persist to FeedRfq table (fire-and-forget)
    const rfqData = params.rfqData;
    prisma.feedRfq
      .create({
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
          expiry: rfqData.expiry,
          status: "OPEN",
          visibility: "public",
        },
      })
      .catch((err: unknown) =>
        console.warn("[rfqRegistry] Failed to persist FeedRfq:", err)
      );

    // Emit feed event
    broadcastFeedEvent({
      type: "rfq.created",
      rfqId: rfqData.id,
      data: rfqData,
      status: "OPEN",
      timestamp: Math.floor(Date.now() / 1000),
    });

    // Telegram notification
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

  // Internal event — broadcast unconditionally for ALL RFQs (public + private)
  broadcastInternalEvent({
    type: "rfq.created",
    rfqId: params.rfqData.id,
    data: params.rfqData,
    status: "OPEN",
    timestamp: Math.floor(Date.now() / 1000),
    visibility: params.visibility,
    allowedMakers: params.rfqData.allowedMakers?.map((a) => a.toLowerCase()),
  });

  // Recount after insertion
  const newCount = countActive(wallet);

  return {
    allowed: true,
    shareToken,
    activeCount: newCount,
  };
}

/**
 * Retrieve a private RFQ by its share token.
 * Returns the RFQ data if found and not expired, null otherwise.
 */
export function getRFQByShareToken(token: string): RFQRequestJSON | null {
  cleanup();

  const entry = rfqStore.get(token);
  if (!entry) return null;

  const now = Math.floor(Date.now() / 1000);
  if (entry.expiry <= now) return null;

  return entry.rfqData;
}

/**
 * Get active RFQ count for a wallet.
 */
export function getActiveCount(wallet: string): {
  public: number;
  private: number;
} {
  cleanup();
  return countActive(wallet.toLowerCase());
}

// ---------------------------------------------------------------------------
// RFQ detail lookup — by ID
// ---------------------------------------------------------------------------

/**
 * Retrieve an RFQ by its request ID.
 * Public RFQs are returned directly.
 * Private RFQs require the correct shareToken for access.
 */
export function getRFQById(
  rfqId: string,
  shareToken?: string
): { rfq: RFQRequestJSON; quotes: RFQQuoteJSON[] } | null {
  cleanup();

  const token = rfqById.get(rfqId);
  if (!token) return null;

  const entry = rfqStore.get(token);
  if (!entry) return null;

  const now = Math.floor(Date.now() / 1000);
  if (entry.expiry <= now) return null;

  // Private RFQs require the share token
  if (entry.visibility === "private") {
    if (!shareToken || shareToken !== entry.shareToken) return null;
  }

  const quotes = quoteStore.get(rfqId) ?? [];
  return { rfq: entry.rfqData, quotes };
}

/**
 * Get the wallet that created an RFQ (for ownership checks).
 * Returns the lowercase wallet address, or null if RFQ not found/expired.
 */
export function getRFQOwner(rfqId: string): string | null {
  const token = rfqById.get(rfqId);
  if (!token) return null;
  const entry = rfqStore.get(token);
  if (!entry) return null;
  return entry.wallet; // already lowercase
}

/**
 * List all active public RFQs (for the feed).
 */
export function listPublicRFQs(): RFQRequestJSON[] {
  cleanup();
  const results: RFQRequestJSON[] = [];
  const now = Math.floor(Date.now() / 1000);

  for (const entry of rfqStore.values()) {
    if (entry.visibility === "public" && entry.expiry > now) {
      results.push(entry.rfqData);
    }
  }

  // Sort by most recent first
  results.sort((a, b) => b.createdAt - a.createdAt);
  return results;
}

// ---------------------------------------------------------------------------
// Quote submission
// ---------------------------------------------------------------------------

const MAX_QUOTES_PER_RFQ = 20;

/**
 * Submit a signed quote for an RFQ.
 * Returns true if accepted, or an error reason string.
 */
export function submitQuote(
  rfqId: string,
  quote: RFQQuoteJSON,
  shareToken?: string
): { accepted: boolean; reason?: string } {
  cleanup();

  const token = rfqById.get(rfqId);
  if (!token) return { accepted: false, reason: "RFQ not found" };

  const entry = rfqStore.get(token);
  if (!entry) return { accepted: false, reason: "RFQ not found" };

  const now = Math.floor(Date.now() / 1000);
  if (entry.expiry <= now) return { accepted: false, reason: "RFQ expired" };

  // Private RFQs require share token
  if (entry.visibility === "private") {
    if (!shareToken || shareToken !== entry.shareToken) {
      return { accepted: false, reason: "Invalid share token for private RFQ" };
    }
  }

  // Enforce allowedMakers list (if set by the taker)
  if (entry.rfqData.allowedMakers?.length) {
    const makerLower = quote.maker.toLowerCase();
    const isAllowed = entry.rfqData.allowedMakers.some(
      (addr) => addr.toLowerCase() === makerLower
    );
    if (!isAllowed) {
      return { accepted: false, reason: "Maker not in allowed list" };
    }
  }

  // Validate requestId matches
  if (quote.requestId !== rfqId) {
    return { accepted: false, reason: "Quote requestId does not match" };
  }

  // Basic structural checks
  if (!quote.signature || quote.signature.length < 130) {
    return { accepted: false, reason: "Signature missing or malformed" };
  }
  if (!quote.maker || !/^0x[0-9a-fA-F]{40}$/.test(quote.maker)) {
    return { accepted: false, reason: "Invalid maker address" };
  }

  // Get or create quotes array
  let quotes = quoteStore.get(rfqId);
  if (!quotes) {
    quotes = [];
    quoteStore.set(rfqId, quotes);
  }

  if (quotes.length >= MAX_QUOTES_PER_RFQ) {
    return { accepted: false, reason: "Maximum quotes for this RFQ reached" };
  }

  // Replace existing quote from same maker, or add new
  const makerLower = quote.maker.toLowerCase();
  const existingIdx = quotes.findIndex(
    (q) => q.maker.toLowerCase() === makerLower
  );
  if (existingIdx >= 0) {
    quotes[existingIdx] = quote;
  } else {
    quotes.push(quote);
  }

  // Broadcast quote to legacy SSE subscribers (for public RFQs)
  if (entry.visibility === "public") {
    broadcastSSE({ type: "quote", rfqId, data: quote });

    // Update FeedRfq quote count + status in Prisma
    const newCount = quotes.length;
    prisma.feedRfq
      .update({
        where: { id: rfqId },
        data: {
          quoteCount: newCount,
          ...(newCount === 1 ? { status: "QUOTED" } : {}),
        },
      })
      .catch(() => {});

    // Emit feed event
    broadcastFeedEvent({
      type: "rfq.quoted",
      rfqId,
      data: entry.rfqData,
      status: newCount === 1 ? "QUOTED" : "QUOTED",
      quoteCount: newCount,
      timestamp: Math.floor(Date.now() / 1000),
    });
  }

  // Internal event — broadcast unconditionally for ALL quotes (public + private)
  broadcastInternalEvent({
    type: "rfq.quoted",
    rfqId,
    data: entry.rfqData,
    status: "QUOTED",
    quoteCount: quotes.length,
    timestamp: Math.floor(Date.now() / 1000),
    visibility: entry.visibility,
    allowedMakers: entry.rfqData.allowedMakers?.map((a) => a.toLowerCase()),
  });

  return { accepted: true };
}

// ---------------------------------------------------------------------------
// Lifecycle mutations — Fill + Cancel
// ---------------------------------------------------------------------------

/**
 * Mark an RFQ as filled (server-side). Updates Prisma + emits SSE.
 */
export async function markRfqFilled(
  rfqId: string,
  txHash: string
): Promise<boolean> {
  const token = rfqById.get(rfqId);
  const entry = token ? rfqStore.get(token) : null;

  // Update Prisma
  try {
    await prisma.feedRfq.update({
      where: { id: rfqId },
      data: { status: "FILLED", fillTxHash: txHash },
    });
  } catch {
    // May not exist if private or not yet persisted
  }

  // Emit feed event (if we have the entry data)
  if (entry && entry.visibility === "public") {
    broadcastFeedEvent({
      type: "rfq.filled",
      rfqId,
      data: entry.rfqData,
      status: "FILLED",
      fillTxHash: txHash,
      timestamp: Math.floor(Date.now() / 1000),
    });

    notifyRfqFilled({
      id: rfqId,
      tokenIn: entry.rfqData.tokenIn,
      tokenOut: entry.rfqData.tokenOut,
      amountIn: entry.rfqData.amountIn,
      amountOut: entry.rfqData.amountOut,
      fillTxHash: txHash,
    });
  }

  // Internal event — broadcast unconditionally for ALL fills
  if (entry) {
    broadcastInternalEvent({
      type: "rfq.filled",
      rfqId,
      data: entry.rfqData,
      status: "FILLED",
      fillTxHash: txHash,
      timestamp: Math.floor(Date.now() / 1000),
      visibility: entry.visibility,
      allowedMakers: entry.rfqData.allowedMakers?.map((a) => a.toLowerCase()),
    });
  }

  return true;
}

/**
 * Mark an RFQ as cancelled/killed (server-side). Updates Prisma + emits SSE.
 */
export async function markRfqCancelled(rfqId: string): Promise<boolean> {
  const token = rfqById.get(rfqId);
  const entry = token ? rfqStore.get(token) : null;

  // Update Prisma
  try {
    await prisma.feedRfq.update({
      where: { id: rfqId },
      data: { status: "KILLED" },
    });
  } catch {
    // May not exist
  }

  // Internal event — broadcast unconditionally for ALL cancellations
  if (entry) {
    broadcastInternalEvent({
      type: "rfq.cancelled",
      rfqId,
      data: entry.rfqData,
      status: "KILLED",
      timestamp: Math.floor(Date.now() / 1000),
      visibility: entry.visibility,
      allowedMakers: entry.rfqData.allowedMakers?.map((a) => a.toLowerCase()),
    });
  }

  if (entry && entry.visibility === "public") {
    broadcastFeedEvent({
      type: "rfq.cancelled",
      rfqId,
      data: entry.rfqData,
      status: "KILLED",
      timestamp: Math.floor(Date.now() / 1000),
    });

    notifyRfqExpiredOrKilled("killed", {
      id: rfqId,
      tokenIn: entry.rfqData.tokenIn,
      tokenOut: entry.rfqData.tokenOut,
    });
  }

  // Clean up from in-memory store (for all visibilities)
  if (token) {
    rfqStore.delete(token);
    rfqById.delete(rfqId);
    quoteStore.delete(rfqId);
    if (entry) {
      const tokens = walletIndex.get(entry.wallet);
      if (tokens) {
        tokens.delete(token);
        if (tokens.size === 0) walletIndex.delete(entry.wallet);
      }
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Legacy SSE subscriber management (used by /api/rfq/stream)
// ---------------------------------------------------------------------------

/**
 * Register an SSE subscriber. Returns an unsubscribe function.
 */
export function addSSESubscriber(writer: SSEWriter): () => void {
  sseSubscribers.add(writer);
  return () => {
    sseSubscribers.delete(writer);
  };
}

/**
 * Broadcast an event to all legacy SSE subscribers.
 */
function broadcastSSE(event: object): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const sub of sseSubscribers) {
    try {
      sub.write(payload);
    } catch {
      // Remove broken subscribers
      sseSubscribers.delete(sub);
    }
  }
}
