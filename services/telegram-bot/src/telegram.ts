/**
 * Rate-limited Telegram message sending.
 *
 * Implements:
 *  - Per-chat queue (1 msg/sec per chat, Telegram limit)
 *  - Global concurrency semaphore (max 20 concurrent sends)
 *  - 429 retry with Telegram's retry_after
 *  - Per-user batch window (2s) to combine multiple alerts
 *  - Circuit breaker (10 consecutive failures → pause 60s)
 */

import { batchMessages } from "./formatter.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const MAX_CONCURRENT = 20;
const BATCH_WINDOW_MS = 2_000;
const MAX_RETRIES = 3;
const CIRCUIT_BREAKER_THRESHOLD = 10;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let activeSends = 0;
let consecutiveFailures = 0;
let circuitOpen = false;
let circuitOpenUntil = 0;

// Per-chat batch queues
const chatBatches = new Map<
  string,
  { messages: string[]; timer: ReturnType<typeof setTimeout> }
>();

// Per-chat send queue (ensures 1 msg/sec per chat)
const chatQueues = new Map<string, Array<() => Promise<void>>>();
const chatProcessing = new Set<string>();

// Delivery stats
export const deliveryStats = {
  sent: 0,
  failed: 0,
  retries: 0,
  circuitBreaks: 0,
  batched: 0,
};

// ---------------------------------------------------------------------------
// Core send function
// ---------------------------------------------------------------------------

async function sendMessageDirect(
  chatId: string,
  text: string,
  retryCount = 0
): Promise<boolean> {
  if (!BOT_TOKEN) {
    console.warn("[telegram] No TELEGRAM_BOT_TOKEN configured");
    return false;
  }

  // Circuit breaker check
  if (circuitOpen) {
    if (Date.now() < circuitOpenUntil) {
      return false;
    }
    // Half-open: allow one request through
    circuitOpen = false;
    consecutiveFailures = 0;
  }

  // Concurrency semaphore
  while (activeSends >= MAX_CONCURRENT) {
    await new Promise((r) => setTimeout(r, 100));
  }
  activeSends++;

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      }
    );

    if (res.ok) {
      consecutiveFailures = 0;
      deliveryStats.sent++;
      return true;
    }

    // Rate limited — respect retry_after
    if (res.status === 429) {
      const data = (await res.json().catch(() => ({}))) as {
        parameters?: { retry_after?: number };
      };
      const retryAfter = data?.parameters?.retry_after ?? 5;
      console.warn(
        `[telegram] Rate limited for chat ${chatId}, retry in ${retryAfter}s`
      );

      if (retryCount < MAX_RETRIES) {
        deliveryStats.retries++;
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        return sendMessageDirect(chatId, text, retryCount + 1);
      }
    }

    // Other error
    consecutiveFailures++;
    deliveryStats.failed++;

    if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      circuitOpen = true;
      circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
      deliveryStats.circuitBreaks++;
      console.error(
        `[telegram] Circuit breaker OPEN — ${consecutiveFailures} consecutive failures`
      );
    }

    if (retryCount < MAX_RETRIES) {
      deliveryStats.retries++;
      const backoff = Math.min(1000 * 2 ** retryCount, 10000);
      await new Promise((r) => setTimeout(r, backoff));
      return sendMessageDirect(chatId, text, retryCount + 1);
    }

    return false;
  } catch (err) {
    consecutiveFailures++;
    deliveryStats.failed++;

    if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      circuitOpen = true;
      circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
      deliveryStats.circuitBreaks++;
      console.error("[telegram] Circuit breaker OPEN — network error");
    }

    if (retryCount < MAX_RETRIES) {
      deliveryStats.retries++;
      const backoff = Math.min(1000 * 2 ** retryCount, 10000);
      await new Promise((r) => setTimeout(r, backoff));
      return sendMessageDirect(chatId, text, retryCount + 1);
    }

    console.error(`[telegram] Failed to send to ${chatId}:`, err);
    return false;
  } finally {
    activeSends--;
  }
}

// ---------------------------------------------------------------------------
// Per-chat sequential queue
// ---------------------------------------------------------------------------

async function processQueue(chatId: string): Promise<void> {
  if (chatProcessing.has(chatId)) return;
  chatProcessing.add(chatId);

  const queue = chatQueues.get(chatId);
  while (queue && queue.length > 0) {
    const task = queue.shift()!;
    await task();
    // 1-second spacing per chat (Telegram rate limit)
    await new Promise((r) => setTimeout(r, 1000));
  }

  chatProcessing.delete(chatId);
  if (queue && queue.length === 0) {
    chatQueues.delete(chatId);
  }
}

function enqueueToChat(chatId: string, task: () => Promise<void>): void {
  if (!chatQueues.has(chatId)) {
    chatQueues.set(chatId, []);
  }
  chatQueues.get(chatId)!.push(task);
  processQueue(chatId);
}

// ---------------------------------------------------------------------------
// Public API — batched send
// ---------------------------------------------------------------------------

/**
 * Queue an alert message for a Telegram user. Messages within a 2s window
 * are batched into a single Telegram message to reduce API calls.
 */
export function queueAlert(chatId: string, messageHtml: string): void {
  const batch = chatBatches.get(chatId);

  if (batch) {
    batch.messages.push(messageHtml);
    deliveryStats.batched++;
    return;
  }

  // Start a new batch window
  const entry = {
    messages: [messageHtml],
    timer: setTimeout(() => flushBatch(chatId), BATCH_WINDOW_MS),
  };
  chatBatches.set(chatId, entry);
}

function flushBatch(chatId: string): void {
  const batch = chatBatches.get(chatId);
  chatBatches.delete(chatId);
  if (!batch || batch.messages.length === 0) return;

  const batched = batchMessages(batch.messages);

  for (const text of batched) {
    enqueueToChat(chatId, async () => { await sendMessageDirect(chatId, text); });
  }
}

/**
 * Send a message immediately (non-batched). Used for command responses.
 * Still respects per-chat rate limiting.
 */
export function sendImmediate(chatId: string, text: string): void {
  enqueueToChat(chatId, async () => { await sendMessageDirect(chatId, text); });
}

/**
 * Flush all pending batches (used during shutdown).
 */
export function flushAll(): void {
  for (const [chatId] of chatBatches) {
    flushBatch(chatId);
  }
}

/**
 * Get current delivery statistics.
 */
export function getDeliveryStats(): typeof deliveryStats & {
  circuitOpen: boolean;
  pendingBatches: number;
  pendingQueues: number;
} {
  return {
    ...deliveryStats,
    circuitOpen,
    pendingBatches: chatBatches.size,
    pendingQueues: chatQueues.size,
  };
}
