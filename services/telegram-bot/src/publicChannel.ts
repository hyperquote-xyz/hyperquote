/**
 * Public Channel Broadcaster — sends public rfq.created and rfq.filled alerts
 * to a Telegram channel.
 *
 * Connects to the Next.js public SSE feed (/api/v1/feed/stream) which requires
 * no authentication and only delivers public events. Filters for:
 *   - rfq.created events (new RFQ announcements)
 *   - rfq.filled events  (fill confirmations, controlled by INCLUDE_FILLS flag)
 *   - Launch token universe (at least one side must be a known token)
 *   - Above configurable minimum notional USD (estimated from stablecoin side)
 *
 * Completely separate from user subscription flows (alertStream.ts).
 * Uses the existing telegram.ts rate-limited sending infrastructure.
 */

import http from "http";
import https from "https";
import { sendImmediate } from "./telegram.js";
import { formatTokenAmount } from "./tokenMap.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const NEXTJS_URL = process.env.NEXTJS_URL ?? "http://localhost:3000";
const APP_URL = process.env.HYPERQUOTE_APP_URL ?? "https://app.hyperquote.trade";
const CHANNEL_ID = process.env.TELEGRAM_PUBLIC_CHANNEL_ID ?? "";
const MIN_NOTIONAL_USD = parseFloat(
  process.env.TELEGRAM_PUBLIC_MIN_NOTIONAL_USD ?? "0"
);
const ENABLED = (process.env.TELEGRAM_PUBLIC_ENABLED ?? "true") === "true";
const INCLUDE_FILLS =
  (process.env.TELEGRAM_PUBLIC_INCLUDE_FILLS ?? "true") === "true";

// Launch token addresses (lowercase) — must match config/tokens.ts in the UI
const LAUNCH_TOKENS = new Set([
  "0x0000000000000000000000000000000000000000", // HYPE (native)
  "0x5555555555555555555555555555555555555555", // WHYPE (wrapped)
  "0xfd739d4e423301ce9385c1fb8850539d657c296d", // kHYPE
  "0x9b498c3c8a0b8cd8ba1d9851d40d186f1872b44e", // PURR
  "0x000000000000780555bd0bca3791f89f9542c2d6", // KNTQ
  "0xbd6dab50f03a305a80037294fa8d1a9dc0cac91b", // HPL
  "0xb88339cb7199b77e23db6e890353e22632ba630f", // USDC (Circle native)
  "0x111111a1a0667d36bd57c0a9f569b98057111111", // USDH
]);

// Stablecoin addresses → decimals (for notional USD estimation)
const STABLECOINS = new Map<string, number>([
  ["0xb88339cb7199b77e23db6e890353e22632ba630f", 6], // USDC (Circle native)
  ["0x111111a1a0667d36bd57c0a9f569b98057111111", 6], // USDH
]);

// Reconnection
const BASE_RECONNECT_MS = 3_000;
const MAX_RECONNECT_MS = 60_000;

// ---------------------------------------------------------------------------
// Feed event types (matches public SSE /api/v1/feed/stream format)
// ---------------------------------------------------------------------------

interface FeedToken {
  address: string;
  symbol: string;
  name?: string;
  decimals: number;
  logoUrl?: string;
}

interface FeedRfqData {
  id: string;
  kind: number; // 0 = EXACT_IN, 1 = EXACT_OUT
  taker?: string;
  tokenIn: FeedToken;
  tokenOut: FeedToken;
  amountIn?: string | null;
  amountOut?: string | null;
  expiry: number;
  createdAt: number;
  visibility?: string;
}

interface FeedEvent {
  type: string;
  rfqId?: string;
  data: FeedRfqData | FeedRfqData[];
  status?: string;
  fillTxHash?: string;
  timestamp?: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let abortController: AbortController | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;

const stats = {
  connected: false,
  eventsReceived: 0,
  eventsPosted: 0,
  eventsFiltered: 0,
  fillsReceived: 0,
  fillsPosted: 0,
  lastEventAt: null as string | null,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the public channel broadcaster.
 * Connects to the public SSE feed and begins posting to the Telegram channel.
 * No-ops if disabled or no channel ID configured.
 */
export function startPublicChannel(): void {
  if (!ENABLED) {
    console.log("[publicChannel] Disabled (TELEGRAM_PUBLIC_ENABLED=false)");
    return;
  }
  if (!CHANNEL_ID) {
    console.log("[publicChannel] Disabled (no TELEGRAM_PUBLIC_CHANNEL_ID set)");
    return;
  }

  console.log("[publicChannel] Starting public channel broadcaster");
  console.log(`[publicChannel]   Channel:      ${CHANNEL_ID}`);
  console.log(
    `[publicChannel]   Min notional: ${MIN_NOTIONAL_USD > 0 ? `$${MIN_NOTIONAL_USD.toLocaleString()}` : "none"}`
  );
  console.log(`[publicChannel]   Include fills: ${INCLUDE_FILLS}`);
  console.log(`[publicChannel]   Feed URL:     ${NEXTJS_URL}/api/v1/feed/stream`);
  console.log(`[publicChannel]   App URL:      ${APP_URL}`);

  connect();
}

/**
 * Stop the public channel broadcaster.
 * Closes the SSE connection and cancels any pending reconnect.
 */
export function stopPublicChannel(): void {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stats.connected = false;
}

/**
 * Get stats for the health endpoint.
 */
export function getPublicChannelStats(): typeof stats & {
  enabled: boolean;
  channelId: string;
  minNotionalUsd: number;
  includeFills: boolean;
} {
  return {
    ...stats,
    enabled: ENABLED,
    channelId: CHANNEL_ID || "(not set)",
    minNotionalUsd: MIN_NOTIONAL_USD,
    includeFills: INCLUDE_FILLS,
  };
}

// ---------------------------------------------------------------------------
// SSE connection
// ---------------------------------------------------------------------------

function connect(): void {
  const feedUrl = `${NEXTJS_URL}/api/v1/feed/stream`;

  abortController = new AbortController();
  const url = new URL(feedUrl);
  const mod = url.protocol === "https:" ? https : http;

  const req = mod.get(feedUrl, { signal: abortController.signal }, (res) => {
    if (res.statusCode !== 200) {
      console.error(`[publicChannel] SSE feed returned ${res.statusCode}`);
      res.resume(); // drain response body
      scheduleReconnect();
      return;
    }

    stats.connected = true;
    reconnectAttempts = 0;
    console.log("[publicChannel] Connected to public SSE feed");

    let buffer = "";

    res.setEncoding("utf8");

    res.on("data", (chunk: string) => {
      buffer += chunk;

      // SSE events are separated by double newlines
      const parts = buffer.split("\n\n");
      buffer = parts.pop()!; // keep incomplete tail

      for (const part of parts) {
        processSSEBlock(part);
      }
    });

    res.on("end", () => {
      stats.connected = false;
      console.log("[publicChannel] SSE feed connection ended");
      scheduleReconnect();
    });

    res.on("error", (err) => {
      stats.connected = false;
      console.error("[publicChannel] SSE stream error:", err.message);
      scheduleReconnect();
    });
  });

  req.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "ABORT_ERR" || err.name === "AbortError") return;
    stats.connected = false;
    console.error("[publicChannel] Connection error:", err.message);
    scheduleReconnect();
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer) return; // already scheduled

  reconnectAttempts++;
  const delay = Math.min(
    BASE_RECONNECT_MS * 2 ** (reconnectAttempts - 1),
    MAX_RECONNECT_MS
  );

  console.log(
    `[publicChannel] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

// ---------------------------------------------------------------------------
// SSE parsing
// ---------------------------------------------------------------------------

function processSSEBlock(block: string): void {
  // An SSE block may contain multiple lines (event:, data:, id:, etc.)
  // We only care about lines starting with "data: "
  const lines = block.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":")) continue; // comment / keepalive

    if (trimmed.startsWith("data: ") || trimmed.startsWith("data:")) {
      const json = trimmed.startsWith("data: ")
        ? trimmed.slice(6)
        : trimmed.slice(5);

      try {
        const event = JSON.parse(json) as FeedEvent;
        handleFeedEvent(event);
      } catch {
        // Ignore parse errors (e.g., partial JSON)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Event handling + filtering
// ---------------------------------------------------------------------------

function handleFeedEvent(event: FeedEvent): void {
  const isFill = event.type === "rfq.filled";
  const isCreate = event.type === "rfq.created";

  // Only handle rfq.created and rfq.filled events
  if (!isCreate && !isFill) return;

  // Fills gated by env flag
  if (isFill && !INCLUDE_FILLS) return;

  // data is a single RFQ for live events (snapshot sends an array)
  const rfq = event.data as FeedRfqData;
  if (!rfq || Array.isArray(rfq)) return;
  if (!rfq.tokenIn || !rfq.tokenOut) return;

  if (isCreate) stats.eventsReceived++;
  if (isFill) stats.fillsReceived++;

  // Filter: launch token universe — at least one side must be a known token
  const tokenInAddr = rfq.tokenIn.address.toLowerCase();
  const tokenOutAddr = rfq.tokenOut.address.toLowerCase();

  if (!LAUNCH_TOKENS.has(tokenInAddr) && !LAUNCH_TOKENS.has(tokenOutAddr)) {
    stats.eventsFiltered++;
    return;
  }

  // Filter: minimum notional USD (based on stablecoin side)
  if (MIN_NOTIONAL_USD > 0) {
    const notional = estimateNotionalUsd(rfq);
    if (notional !== null && notional < MIN_NOTIONAL_USD) {
      stats.eventsFiltered++;
      return;
    }
    // notional === null means no stablecoin side → can't estimate, allow through
  }

  // Format and send to channel
  const message = isFill
    ? formatFillMessage(rfq, event.fillTxHash)
    : formatPublicChannelMessage(rfq);
  sendImmediate(CHANNEL_ID, message);

  if (isCreate) stats.eventsPosted++;
  if (isFill) stats.fillsPosted++;
  stats.lastEventAt = new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Notional USD estimation
// ---------------------------------------------------------------------------

/**
 * Estimate USD notional from the stablecoin side of the pair.
 * Returns null if neither side is a stablecoin (can't estimate).
 */
function estimateNotionalUsd(rfq: FeedRfqData): number | null {
  const inAddr = rfq.tokenIn.address.toLowerCase();
  const outAddr = rfq.tokenOut.address.toLowerCase();

  // Check tokenIn first
  if (STABLECOINS.has(inAddr) && rfq.amountIn) {
    const decimals = STABLECOINS.get(inAddr)!;
    return parseRawAmount(rfq.amountIn, decimals);
  }

  // Then tokenOut
  if (STABLECOINS.has(outAddr) && rfq.amountOut) {
    const decimals = STABLECOINS.get(outAddr)!;
    return parseRawAmount(rfq.amountOut, decimals);
  }

  return null;
}

function parseRawAmount(raw: string, decimals: number): number {
  try {
    return Number(BigInt(raw)) / 10 ** decimals;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Message formatting
// ---------------------------------------------------------------------------

function formatPublicChannelMessage(rfq: FeedRfqData): string {
  const isExactIn = rfq.kind === 0;

  const amount = isExactIn
    ? fmtAmount(rfq.amountIn, rfq.tokenIn)
    : fmtAmount(rfq.amountOut, rfq.tokenOut);

  const direction = isExactIn ? "Exact In" : "Exact Out";
  const ttl = fmtTtl(rfq.expiry);
  const deepLink = `https://app.hyperquote.trade/rfq/${rfq.id}`;

  const lines = [
    `🔔 <b>NEW RFQ</b>`,
    `PAIR: ${rfq.tokenIn.symbol}/${rfq.tokenOut.symbol}`,
    `SELL: ${amount}`,
    `Type: ${direction}`,
    `Expires: ${ttl}`,
    `⚡ <a href="${deepLink}">Respond on HyperQuote</a>`,
  ];

  return lines.join("\n");
}

function formatFillMessage(
  rfq: FeedRfqData,
  fillTxHash?: string
): string {
  const isExactIn = rfq.kind === 0;

  // Show the "fixed" side as SIZE — the amount that was specified by the taker
  const size = isExactIn
    ? fmtAmount(rfq.amountIn, rfq.tokenIn)
    : fmtAmount(rfq.amountOut, rfq.tokenOut);

  const deepLink = `https://app.hyperquote.trade/rfq/${rfq.id}`;

  const lines = [
    `✅ <b>RFQ FILLED</b>`,
    `PAIR: ${rfq.tokenIn.symbol}/${rfq.tokenOut.symbol}`,
    `SIZE: ${size}`,
    `Filled on HyperQuote`,
  ];

  // Include tx hash link if available (Hyperliquid Explorer)
  if (fillTxHash) {
    lines.push(
      `TX: <a href="https://explorer.hyperliquid.xyz/tx/${fillTxHash}">${fillTxHash.slice(0, 10)}…</a>`
    );
  }

  lines.push(`⚡ <a href="${deepLink}">View on HyperQuote</a>`);

  return lines.join("\n");
}

function fmtAmount(raw: string | null | undefined, token: FeedToken): string {
  if (!raw) return "?";
  const formatted = formatTokenAmount(raw, token.decimals);
  return `${formatted} ${token.symbol}`;
}

function fmtTtl(expiry: number): string {
  const now = Math.floor(Date.now() / 1000);
  const sec = expiry - now;
  if (sec <= 0) return "expired";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${Math.round(sec / 3600)}h`;
}
