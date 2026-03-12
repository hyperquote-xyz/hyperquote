/**
 * Telegram broadcast utility for RFQ feed events.
 *
 * Env vars:
 *   TELEGRAM_BOT_TOKEN   — Bot API token from @BotFather
 *   TELEGRAM_CHANNEL_ID  — Chat/channel ID to post to
 *
 * Rate limiting: batches messages within a 10-second window before sending.
 * No-ops silently if either env var is missing (safe for dev).
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const BATCH_WINDOW_MS = 10_000;
const MAX_MESSAGE_LENGTH = 4000; // Telegram limit is 4096

// ---------------------------------------------------------------------------
// Batch queue
// ---------------------------------------------------------------------------

let messageQueue: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flushQueue(): Promise<void> {
  if (!BOT_TOKEN || !CHANNEL_ID || messageQueue.length === 0) return;

  const batch = [...messageQueue];
  messageQueue = [];
  flushTimer = null;

  // Combine into one message (respect Telegram char limit)
  const combined = batch.join("\n\n").slice(0, MAX_MESSAGE_LENGTH);

  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHANNEL_ID,
        text: combined,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  } catch (err) {
    console.warn("[telegram] Failed to send:", err);
  }
}

function enqueue(text: string): void {
  if (!BOT_TOKEN || !CHANNEL_ID) return;
  messageQueue.push(text);
  if (!flushTimer) {
    flushTimer = setTimeout(flushQueue, BATCH_WINDOW_MS);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function notifyRfqCreated(rfq: {
  id: string;
  tokenIn: { symbol: string };
  tokenOut: { symbol: string };
  amountIn?: string | null;
  amountOut?: string | null;
  kind: number;
  expiry: number;
  taker: string;
}): void {
  const isExactIn = rfq.kind === 0;
  const size = isExactIn
    ? `${rfq.amountIn ?? "?"} ${rfq.tokenIn.symbol}`
    : `${rfq.amountOut ?? "?"} ${rfq.tokenOut.symbol}`;
  const ttlSec = rfq.expiry - Math.floor(Date.now() / 1000);
  const ttl = ttlSec > 60 ? `${Math.round(ttlSec / 60)}m` : `${ttlSec}s`;

  enqueue(
    `<b>NEW RFQ</b>: ${size} ${rfq.tokenIn.symbol} → ${rfq.tokenOut.symbol} (${isExactIn ? "Exact In" : "Exact Out"}) | Expires: ${ttl} | Taker: ${rfq.taker.slice(0, 8)}…`
  );
}

export function notifyRfqFilled(rfq: {
  id: string;
  tokenIn: { symbol: string };
  tokenOut: { symbol: string };
  amountIn?: string | null;
  amountOut?: string | null;
  fillTxHash?: string | null;
}): void {
  const size = rfq.amountIn ? `${rfq.amountIn} ${rfq.tokenIn.symbol}` : "";
  const out = rfq.amountOut ? ` → ${rfq.amountOut} ${rfq.tokenOut.symbol}` : "";
  const tx = rfq.fillTxHash ? ` | Tx: ${rfq.fillTxHash.slice(0, 16)}…` : "";

  enqueue(`<b>FILLED</b>: ${size}${out}${tx}`);
}

export function notifyRfqExpiredOrKilled(
  event: "expired" | "killed",
  rfq: {
    id: string;
    tokenIn: { symbol: string };
    tokenOut: { symbol: string };
    amountInUsd?: number;
  }
): void {
  // Only broadcast expired/killed if notional >= $25k to avoid spam
  if ((rfq.amountInUsd ?? 0) < 25_000) return;

  const label = event === "expired" ? "EXPIRED" : "KILLED";
  enqueue(
    `<b>${label}</b>: ${rfq.tokenIn.symbol} → ${rfq.tokenOut.symbol}`
  );
}
