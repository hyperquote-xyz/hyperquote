/**
 * Alert payload → Telegram HTML message formatting.
 *
 * Uses HTML parse_mode consistent with the existing broadcast channel
 * at apps/hyperquote-ui/src/lib/telegram.ts.
 */

import type {
  AlertPayload,
  AlertRfqCreated,
  AlertRfqFilled,
  TokenInfo,
} from "./types.js";
import { formatTokenAmount } from "./tokenMap.js";

// ---------------------------------------------------------------------------
// Amount formatting
// ---------------------------------------------------------------------------

function fmtAmount(
  raw: string | null | undefined,
  token: TokenInfo
): string {
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

function fmtAddress(addr: string | undefined): string {
  if (!addr) return "?";
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Format rfq.created
// ---------------------------------------------------------------------------

function formatCreated(alert: AlertRfqCreated): string {
  const pair = `${alert.rfq.tokenIn.symbol}/${alert.rfq.tokenOut.symbol}`;
  const isExactIn = alert.rfq.kind === 0;
  const size = isExactIn
    ? fmtAmount(alert.rfq.amountIn, alert.rfq.tokenIn)
    : fmtAmount(alert.rfq.amountOut, alert.rfq.tokenOut);
  const direction = isExactIn ? "Exact In" : "Exact Out";
  const ttl = fmtTtl(alert.rfq.expiry);
  const vis = alert.visibility === "private" ? " | Private" : "";

  const lines = [
    `<b>NEW RFQ</b> ${pair}`,
    `${size} (${direction})${vis}`,
    `Expires: ${ttl} | Quotes: ${alert.quoteCount}`,
  ];

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Format rfq.filled
// ---------------------------------------------------------------------------

function formatFilled(alert: AlertRfqFilled): string {
  const pair = `${alert.rfq.tokenIn.symbol}/${alert.rfq.tokenOut.symbol}`;
  const inAmt = fmtAmount(alert.rfq.amountIn, alert.rfq.tokenIn);
  const outAmt = fmtAmount(alert.rfq.amountOut, alert.rfq.tokenOut);

  const lines = [
    `<b>FILLED</b> ${pair}`,
    `${inAmt} \u2192 ${outAmt}`,
  ];

  if (alert.fill.txHash) {
    lines.push(
      `<a href="https://purrsec.com/tx/${alert.fill.txHash}">View Tx</a>`
    );
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Format an alert payload into an HTML string suitable for Telegram sendMessage.
 */
export function formatAlert(alert: AlertPayload): string {
  switch (alert.eventType) {
    case "rfq.created":
      return formatCreated(alert);
    case "rfq.filled":
      return formatFilled(alert);
    default:
      return `<b>Alert</b>: ${(alert as AlertPayload).eventType}`;
  }
}

/**
 * Combine multiple alert messages into a single batched message.
 * Respects Telegram's 4096 char limit.
 */
export function batchMessages(messages: string[]): string[] {
  const MAX_LENGTH = 4000; // leave room for Telegram overhead
  const batches: string[] = [];
  let current = "";

  for (const msg of messages) {
    const separator = current ? "\n\n" : "";
    if (current.length + separator.length + msg.length > MAX_LENGTH) {
      if (current) batches.push(current);
      current = msg;
    } else {
      current += separator + msg;
    }
  }

  if (current) batches.push(current);
  return batches;
}
