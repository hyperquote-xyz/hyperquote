/**
 * HyperQuote Agent SDK — Monitor
 *
 * Read-only agent for watching the feed, querying venues, and accessing
 * leaderboard data. No wallet or private key required.
 *
 * Usage:
 * ```typescript
 * const monitor = new Monitor({
 *   baseUrl: "https://app.hyperquote.io",
 *   apiKey: "hq_live_...",
 * });
 *
 * await monitor.connect();
 * monitor.on("rfq.created", (rfq) => console.log("New RFQ:", rfq));
 *
 * const venues = await monitor.getVenuePricing({
 *   tokenIn: "USDC", tokenOut: "HYPE", amountIn: "10000000000"
 * });
 * ```
 */

import { HyperQuoteClient } from "./client.js";
import { EventStream } from "./stream.js";
import { TokenResolver } from "./tokens.js";
import type {
  HyperQuoteConfig,
  SpotRFQRequest,
  SpotQuote,
  TokenInfo,
  VenueComparisonResult,
  LeaderboardResult,
  ContractInfo,
  FeedEventType,
  EventHandler,
} from "./types.js";

export class Monitor {
  readonly client: HyperQuoteClient;
  readonly tokens: TokenResolver;
  private stream: EventStream | null = null;

  constructor(config: HyperQuoteConfig) {
    this.client = new HyperQuoteClient(config);
    this.tokens = new TokenResolver(this.client);
  }

  /**
   * Connect to the SSE feed for live events.
   */
  async connect(): Promise<void> {
    this.stream = new EventStream({
      url: `${this.client.getBaseUrl()}/api/v1/agent/feed/stream`,
      apiKey: this.client.getApiKey(),
    });
    await this.stream.connect();
  }

  /**
   * Disconnect from the SSE feed.
   */
  disconnect(): void {
    this.stream?.disconnect();
    this.stream = null;
  }

  /**
   * Register an event listener.
   * Returns an unsubscribe function.
   */
  on(eventType: FeedEventType | "*", handler: EventHandler): () => void {
    if (!this.stream) {
      throw new Error("Not connected. Call connect() first.");
    }
    return this.stream.on(eventType, handler);
  }

  // ── Query Methods ──

  /**
   * Get venue pricing comparison for a token pair.
   */
  async getVenuePricing(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
  }): Promise<VenueComparisonResult> {
    return this.client.estimateVenues(params);
  }

  /**
   * List active public RFQs.
   */
  async listRfqs(params?: {
    source?: "live" | "db" | "both";
    status?: "open" | "all";
    limit?: number;
    cursor?: string;
  }): Promise<{ items: SpotRFQRequest[] }> {
    return this.client.listRfqs(params);
  }

  /**
   * Get RFQ detail with quotes.
   */
  async getRfq(
    rfqId: string,
    shareToken?: string
  ): Promise<{ rfq: SpotRFQRequest; quotes: SpotQuote[] }> {
    return this.client.getRfq(rfqId, shareToken);
  }

  /**
   * Get available tokens.
   */
  async getTokens(params?: {
    tier?: "core" | "verified" | "all";
    q?: string;
  }): Promise<TokenInfo[]> {
    const result = await this.client.getTokens(params);
    return result.tokens;
  }

  /**
   * Get leaderboard data.
   */
  async getLeaderboard(params?: {
    tab?: "makers" | "takers";
    window?: "7d" | "30d" | "all";
    cursor?: string;
    limit?: number;
  }): Promise<LeaderboardResult> {
    return this.client.getLeaderboard(params);
  }

  /**
   * Get contract info.
   */
  async getContractInfo(): Promise<ContractInfo> {
    return this.client.getContractInfo();
  }

  /**
   * Check if connected to the feed.
   */
  isConnected(): boolean {
    return this.stream?.isConnected() ?? false;
  }
}
