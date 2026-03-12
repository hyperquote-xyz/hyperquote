/**
 * Event source — SSE client that connects to the Next.js internal events endpoint.
 *
 * Streams InternalFeedEvent payloads from /api/v1/internal/events.
 * Auto-reconnects on error with exponential backoff.
 */

import type { InternalFeedEvent } from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const NEXTJS_URL = process.env.NEXTJS_URL ?? "http://localhost:3000";
const INTERNAL_EVENT_SECRET = process.env.INTERNAL_EVENT_SECRET ?? "";
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

// ---------------------------------------------------------------------------
// SSE client using fetch (no external EventSource dependency needed)
// ---------------------------------------------------------------------------

export type EventHandler = (event: InternalFeedEvent) => void;

interface EventSourceState {
  connected: boolean;
  reconnectAttempts: number;
  totalReconnects: number; // lifetime counter
  abortController: AbortController | null;
}

const state: EventSourceState = {
  connected: false,
  reconnectAttempts: 0,
  totalReconnects: 0,
  abortController: null,
};

let eventHandler: EventHandler | null = null;

/**
 * Start the SSE connection to the internal events endpoint.
 * Calls the handler for each InternalFeedEvent received.
 */
export function startEventSource(handler: EventHandler): void {
  eventHandler = handler;
  connect();
}

/**
 * Stop the SSE connection.
 */
export function stopEventSource(): void {
  state.abortController?.abort();
  state.abortController = null;
  state.connected = false;
  eventHandler = null;
}

/**
 * Get the current connection status.
 */
export function isEventSourceConnected(): boolean {
  return state.connected;
}

/**
 * Get the total number of SSE reconnect attempts (lifetime).
 */
export function getReconnectCount(): number {
  return state.totalReconnects;
}

// ---------------------------------------------------------------------------
// Internal connection logic
// ---------------------------------------------------------------------------

async function connect(): Promise<void> {
  if (!INTERNAL_EVENT_SECRET) {
    console.error("[eventSource] INTERNAL_EVENT_SECRET not set — cannot connect to internal SSE");
    return;
  }

  state.abortController = new AbortController();

  try {
    console.log(`[eventSource] Connecting to ${NEXTJS_URL}/api/v1/internal/events...`);

    const res = await fetch(`${NEXTJS_URL}/api/v1/internal/events`, {
      method: "GET",
      headers: {
        Authorization: `Internal ${INTERNAL_EVENT_SECRET}`,
        Accept: "text/event-stream",
      },
      signal: state.abortController.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    if (!res.body) {
      throw new Error("Response body is null");
    }

    state.connected = true;
    state.reconnectAttempts = 0;
    console.log("[eventSource] Connected to internal SSE");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE lines
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // Keep incomplete last line in buffer

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr);

            // Skip the "connected" confirmation message
            if (event.type === "connected") {
              continue;
            }

            // Dispatch to handler
            if (eventHandler) {
              eventHandler(event as InternalFeedEvent);
            }
          } catch (parseErr) {
            console.warn("[eventSource] Failed to parse event:", parseErr);
          }
        }
        // Ignore comment lines (keep-alive) and empty lines
      }
    }

    // Stream ended normally
    state.connected = false;
    console.log("[eventSource] SSE stream ended");
    scheduleReconnect();
  } catch (err) {
    state.connected = false;

    if ((err as Error).name === "AbortError") {
      console.log("[eventSource] Connection aborted");
      return; // Don't reconnect on intentional abort
    }

    console.error("[eventSource] Connection error:", (err as Error).message);
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  if (!eventHandler) return; // Stopped — don't reconnect

  state.reconnectAttempts++;
  state.totalReconnects++;
  const delay = Math.min(
    RECONNECT_BASE_MS * Math.pow(2, state.reconnectAttempts - 1),
    RECONNECT_MAX_MS
  );

  console.log(
    `[eventSource] Reconnecting in ${delay}ms (attempt ${state.reconnectAttempts})...`
  );

  setTimeout(() => {
    if (eventHandler) connect();
  }, delay);
}
