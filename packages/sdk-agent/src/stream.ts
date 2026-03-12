/**
 * HyperQuote Agent SDK — EventStream
 *
 * Server-Sent Events client with auto-reconnect.
 * Used by TakerAgent, MakerAgent, and Monitor for live feed.
 */

import type { FeedEvent, EventHandler, FeedEventType } from "./types.js";
import { sleep } from "./utils.js";

export interface EventStreamConfig {
  url: string;
  apiKey: string;
  /** Max reconnection attempts (default: Infinity) */
  maxRetries?: number;
  /** Initial reconnect delay in ms (default: 1000) */
  reconnectDelayMs?: number;
  /** Max reconnect delay in ms (default: 30000) */
  maxReconnectDelayMs?: number;
}

type ListenerMap = Map<string, Set<EventHandler>>;

export class EventStream {
  private config: EventStreamConfig;
  private listeners: ListenerMap = new Map();
  private abortController: AbortController | null = null;
  private reconnectAttempt = 0;
  private running = false;

  constructor(config: EventStreamConfig) {
    this.config = config;
  }

  /**
   * Register an event listener.
   * Returns an unsubscribe function.
   */
  on(eventType: FeedEventType | "*", handler: EventHandler): () => void {
    const key = eventType;
    let handlers = this.listeners.get(key);
    if (!handlers) {
      handlers = new Set();
      this.listeners.set(key, handlers);
    }
    handlers.add(handler);

    return () => {
      handlers!.delete(handler);
      if (handlers!.size === 0) {
        this.listeners.delete(key);
      }
    };
  }

  /**
   * Start the SSE connection. Auto-reconnects on disconnect.
   */
  async connect(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.reconnectAttempt = 0;

    await this.connectLoop();
  }

  /**
   * Stop the SSE connection.
   */
  disconnect(): void {
    this.running = false;
    this.abortController?.abort();
    this.abortController = null;
  }

  /**
   * Check if the stream is connected.
   */
  isConnected(): boolean {
    return this.running && this.abortController !== null;
  }

  // ── Internal ──

  private async connectLoop(): Promise<void> {
    const maxRetries = this.config.maxRetries ?? Infinity;
    const baseDelay = this.config.reconnectDelayMs ?? 1000;
    const maxDelay = this.config.maxReconnectDelayMs ?? 30000;

    while (this.running) {
      try {
        await this.connectOnce();
      } catch (err) {
        if (!this.running) break;

        this.reconnectAttempt++;

        if (this.reconnectAttempt > maxRetries) {
          console.error(
            `[EventStream] Max retries (${maxRetries}) exceeded. Giving up.`
          );
          this.running = false;
          break;
        }

        const delay = Math.min(
          baseDelay * 2 ** (this.reconnectAttempt - 1),
          maxDelay
        );
        const jitter = delay * (0.5 + Math.random() * 0.5);

        console.warn(
          `[EventStream] Disconnected (attempt ${this.reconnectAttempt}). ` +
            `Reconnecting in ${Math.round(jitter)}ms...`,
          err instanceof Error ? err.message : ""
        );

        await sleep(jitter);
      }
    }
  }

  private async connectOnce(): Promise<void> {
    this.abortController = new AbortController();

    const response = await fetch(this.config.url, {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        Accept: "text/event-stream",
      },
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      throw new Error(`SSE connection failed: HTTP ${response.status}`);
    }

    if (!response.body) {
      throw new Error("SSE response has no body");
    }

    // Reset reconnect counter on successful connection
    this.reconnectAttempt = 0;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (this.running) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE messages (delimited by \n\n)
        const messages = buffer.split("\n\n");
        buffer = messages.pop() ?? ""; // Keep incomplete message in buffer

        for (const message of messages) {
          this.processMessage(message);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private processMessage(raw: string): void {
    // SSE format: "data: {...}\n" or ": comment\n"
    const lines = raw.split("\n");

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const jsonStr = line.slice(6);
        try {
          const event = JSON.parse(jsonStr) as FeedEvent;
          this.emit(event);
        } catch {
          // Ignore malformed JSON
        }
      }
      // Ignore comments (": keep-alive")
    }
  }

  private emit(event: FeedEvent): void {
    // Emit to specific type listeners
    const typeHandlers = this.listeners.get(event.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          handler(event);
        } catch (err) {
          console.error(`[EventStream] Handler error for ${event.type}:`, err);
        }
      }
    }

    // Emit to wildcard listeners
    const wildcardHandlers = this.listeners.get("*");
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try {
          handler(event);
        } catch (err) {
          console.error("[EventStream] Wildcard handler error:", err);
        }
      }
    }
  }
}
