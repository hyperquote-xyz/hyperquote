/**
 * HyperQuote Agent SDK — HTTP Client
 *
 * Core HTTP wrapper for the Agent API gateway.
 * Handles authentication, error mapping, and request/response serialization.
 */

import type {
  HyperQuoteConfig,
  AgentInfo,
  TokenInfo,
  ContractInfo,
  LeaderboardResult,
  VenueComparisonResult,
  SpotRFQRequest,
  SpotQuote,
  CreateRFQParams,
  CreateRFQResult,
  RegisterParams,
  RegisterResult,
} from "./types.js";
import {
  HyperQuoteError,
  AuthError,
  RateLimitError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  NetworkError,
} from "./errors.js";

export class HyperQuoteClient {
  private readonly baseUrl: string;
  private apiKey: string;
  private readonly timeout: number;

  constructor(config: HyperQuoteConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? 30_000;
  }

  // ── HTTP primitives ──

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return this.request<T>("GET", url.toString());
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", `${this.baseUrl}${path}`, body);
  }

  private async request<T>(
    method: string,
    url: string,
    body?: unknown
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw this.mapError(response.status, json, url);
      }

      return json as T;
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof HyperQuoteError) throw err;

      if (err instanceof DOMException && err.name === "AbortError") {
        throw new NetworkError(`Request timed out after ${this.timeout}ms: ${url}`);
      }

      throw new NetworkError(
        `Request failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private mapError(
    status: number,
    json: Record<string, unknown>,
    url: string
  ): HyperQuoteError {
    const message = (json.error as string) ?? `HTTP ${status}`;

    switch (status) {
      case 401:
        return new AuthError(message);
      case 403:
        return new ForbiddenError(message);
      case 404:
        return new NotFoundError(message);
      case 429: {
        const retryHeader = json.retryAfterMs;
        const retryMs =
          typeof retryHeader === "number"
            ? retryHeader
            : 60_000;
        return new RateLimitError(message, retryMs);
      }
      case 400:
        return new ValidationError(message);
      default:
        return new HyperQuoteError(`${message} (${url})`, `HTTP_${status}`);
    }
  }

  // ── Auth ──

  /** Validate API key and get agent info */
  async getAgentInfo(): Promise<AgentInfo> {
    return this.get<AgentInfo>("/api/v1/agent/auth");
  }

  /** Register a new agent (no auth required — uses wallet signature) */
  async register(params: RegisterParams): Promise<RegisterResult> {
    // Registration uses the base URL directly (no auth header needed)
    const response = await fetch(`${this.baseUrl}/api/v1/agent/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw this.mapError(response.status, json, "/api/v1/agent/register");
    }
    return json as RegisterResult;
  }

  /**
   * Rotate the agent's API key.
   * Generates a new key, invalidates the old one, and updates the client
   * so subsequent requests use the new key automatically.
   *
   * @returns The new raw API key (store securely — shown once)
   */
  async rotateKey(): Promise<{ apiKey: string; prefix: string; rotatedAt: string }> {
    const result = await this.post<{
      agentId: string;
      apiKey: string;
      prefix: string;
      rotatedAt: string;
    }>("/api/v1/agent/keys/rotate");

    // Update the client's key so it keeps working
    this.apiKey = result.apiKey;

    return {
      apiKey: result.apiKey,
      prefix: result.prefix,
      rotatedAt: result.rotatedAt,
    };
  }

  // ── RFQ ──

  /** List active public RFQs */
  async listRfqs(params?: {
    source?: "live" | "db" | "both";
    status?: "open" | "all";
    limit?: number;
    cursor?: string;
  }): Promise<{ items: SpotRFQRequest[]; nextCursor?: string; source: string }> {
    return this.get("/api/v1/agent/rfqs", params);
  }

  /** Get RFQ detail by ID */
  async getRfq(
    rfqId: string,
    shareToken?: string
  ): Promise<{ rfq: SpotRFQRequest; quotes: SpotQuote[]; source: string }> {
    return this.get(`/api/v1/agent/rfqs/${rfqId}`, { shareToken });
  }

  /** Create a new RFQ */
  async createRfq(params: CreateRFQParams): Promise<CreateRFQResult> {
    return this.post("/api/v1/agent/rfqs", params);
  }

  /** Get quotes for an RFQ */
  async getQuotes(
    rfqId: string,
    shareToken?: string
  ): Promise<{ rfqId: string; quotes: SpotQuote[]; count: number }> {
    return this.get(`/api/v1/agent/rfqs/${rfqId}/quotes`, { shareToken });
  }

  /** Mark an RFQ as filled */
  async markFilled(
    rfqId: string,
    txHash: string,
    opts?: {
      maker: string;
      amountIn: string;
      amountOut: string;
      amountInUsd: number;
    }
  ): Promise<{
    success: boolean;
    rfqId: string;
    txHash: string;
    fill?: {
      id: string;
      improvementBps: number;
      takerPoints: number;
      makerPoints: number;
    };
  }> {
    return this.post(`/api/v1/agent/rfqs/${rfqId}/fill`, {
      txHash,
      ...opts,
    });
  }

  // ── Quotes ──

  /** Submit a signed quote */
  async submitQuote(quote: {
    rfqId: string;
    kind: number;
    maker: string;
    taker: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    amountOut: string;
    expiry: number;
    nonce: string;
    signature: string;
    shareToken?: string;
  }): Promise<{ accepted: boolean; rfqId: string }> {
    return this.post("/api/v1/agent/quotes", quote);
  }

  // ── Query ──

  /** Get venue pricing comparison */
  async estimateVenues(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
  }): Promise<VenueComparisonResult> {
    return this.get("/api/v1/agent/venues", params);
  }

  /** List available tokens */
  async getTokens(params?: {
    tier?: "core" | "verified" | "all";
    q?: string;
  }): Promise<{ count: number; tier: string; tokens: TokenInfo[] }> {
    return this.get("/api/v1/agent/tokens", params);
  }

  /** Get RFQ contract info */
  async getContractInfo(): Promise<ContractInfo> {
    return this.get("/api/v1/agent/contract");
  }

  /** Get leaderboard */
  async getLeaderboard(params?: {
    tab?: "makers" | "takers";
    window?: "7d" | "30d" | "all";
    cursor?: string;
    limit?: number;
  }): Promise<LeaderboardResult> {
    return this.get("/api/v1/agent/leaderboard", params);
  }

  // ── Accessors ──

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getApiKey(): string {
    return this.apiKey;
  }
}
