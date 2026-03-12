/**
 * HyperQuote Agent SDK — Type Definitions
 *
 * Core types for interacting with the HyperQuote Agent API.
 * Designed to be extensible for future options support.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface HyperQuoteConfig {
  /** Base URL of the HyperQuote server (e.g. "https://app.hyperquote.io") */
  baseUrl: string;
  /** API key (hq_live_...) */
  apiKey: string;
  /** Chain ID (default: 999 = HyperEVM) */
  chainId?: number;
  /** JSON-RPC URL for on-chain reads/writes */
  rpcUrl?: string;
  /** HTTP request timeout in ms (default: 30000) */
  timeout?: number;
}

export interface AgentConfig extends HyperQuoteConfig {
  /** Private key for signing transactions and quotes */
  privateKey: string;
}

export interface MakerConfig extends AgentConfig {
  /** WebSocket URL for the relay server (optional — falls back to SSE) */
  relayWsUrl?: string;
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  tier?: "core" | "verified" | "unverified";
  verified?: boolean;
  logoUrl?: string;
  venue?: "hypercore" | "hyperevm" | "both";
  isNative?: boolean;
  wrappedAddress?: string;
  hyperliquidCoin?: string;
}

// ---------------------------------------------------------------------------
// RFQ
// ---------------------------------------------------------------------------

/** QuoteKind enum matching the smart contract */
export enum QuoteKind {
  EXACT_IN = 0,
  EXACT_OUT = 1,
}

export type RFQVisibility = "public" | "private";
export type RFQStatus = "OPEN" | "QUOTED" | "FILLED" | "EXPIRED" | "KILLED";

/** Base RFQ request (extensible for options) */
export interface BaseRFQRequest {
  id: string;
  kind: QuoteKind;
  taker: string;
  expiry: number;
  createdAt: number;
  visibility: RFQVisibility;
}

/** Spot RFQ request */
export interface SpotRFQRequest extends BaseRFQRequest {
  tokenIn: TokenInfo;
  tokenOut: TokenInfo;
  amountIn?: string; // BigInt string
  amountOut?: string; // BigInt string
  allowedMakers?: string[];
}

/** Spot RFQ quote (signed by maker) */
export interface SpotQuote {
  kind: QuoteKind;
  maker: string;
  taker: string;
  tokenIn: string; // address
  tokenOut: string; // address
  amountIn: string; // BigInt string
  amountOut: string; // BigInt string
  expiry: number;
  nonce: string; // BigInt string
  requestId: string;
  signature: string;
  createdAt: number;
}

/** Create RFQ parameters */
export interface CreateRFQParams {
  /** Input token (address or symbol) */
  tokenIn: string;
  /** Output token (address or symbol) */
  tokenOut: string;
  /** Amount in (BigInt string, for EXACT_IN) */
  amountIn?: string;
  /** Amount out (BigInt string, for EXACT_OUT) */
  amountOut?: string;
  /** Quote kind (default: EXACT_IN) */
  kind?: QuoteKind;
  /** Time to live in seconds (default: 30, range: 10-300) */
  ttlSeconds?: number;
  /** Visibility (default: "public") */
  visibility?: RFQVisibility;
  /** Restrict quotes to specific maker addresses */
  allowedMakers?: string[];
}

/** Create RFQ response */
export interface CreateRFQResult {
  rfqId: string;
  shareToken: string;
  expiry: number;
  ttlSeconds: number;
  activeCount: { public: number; private: number };
}

// ---------------------------------------------------------------------------
// Venue Estimation
// ---------------------------------------------------------------------------

export interface VenueEstimate {
  /** "ok" | "partial" | "no_liquidity" | "error" */
  ok: string;
  source?: string;
  amountOut?: string;
  slippagePct?: number;
  slippageVsMid?: number | null;
  priceImpact?: number;
  route?: string[];
  [key: string]: unknown;
}

export interface VenueComparisonResult {
  hc?: VenueEstimate;
  dex?: VenueEstimate;
  midPrice?: unknown;
  elapsedMs?: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Fill
// ---------------------------------------------------------------------------

export interface FillResult {
  txHash: string;
  rfqId?: string;
  blockNumber?: number;
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export interface LeaderboardEntry {
  address: string;
  points: number;
  fills: number;
  volume: number;
  [key: string]: unknown;
}

export interface LeaderboardResult {
  tab: string;
  window: string;
  entries: LeaderboardEntry[];
  totalParticipants: number;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Feed Events (SSE)
// ---------------------------------------------------------------------------

export type FeedEventType =
  | "snapshot"
  | "connected"
  | "rfq.created"
  | "rfq.quoted"
  | "rfq.filled"
  | "rfq.cancelled"
  | "rfq.expired";

export interface FeedEvent {
  type: FeedEventType;
  rfqId?: string;
  data?: unknown;
  status?: RFQStatus;
  quoteCount?: number;
  fillTxHash?: string;
  timestamp?: number;
  agentId?: string;
  agentName?: string;
}

// ---------------------------------------------------------------------------
// Contract Info
// ---------------------------------------------------------------------------

export interface ContractInfo {
  rfq: {
    address: string;
    abi: unknown[];
    chainId: number;
    rpcUrl: string;
  };
  erc20: {
    abi: unknown[];
  };
  signing: {
    method: string;
    description: string;
  };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface AgentInfo {
  agentId: string;
  name: string;
  roles: string[];
  wallet: string;
  owner: string;
  rateLimit: {
    perMinute: number;
    perHour: number;
  };
}

export interface RegisterParams {
  name: string;
  ownerWallet: string;
  agentWallet: string;
  roles: string[];
  description?: string;
  signature: string;
  timestamp: number;
}

export interface RegisterResult {
  agentId: string;
  apiKey: string;
  prefix: string;
  name: string;
  roles: string[];
  wallet: string;
  owner: string;
}

// ---------------------------------------------------------------------------
// SDK event callbacks
// ---------------------------------------------------------------------------

export type RfqHandler = (rfq: SpotRFQRequest) => void;
export type QuoteHandler = (quote: SpotQuote) => void;
export type FillHandler = (data: { rfqId: string; txHash: string }) => void;
export type EventHandler = (event: FeedEvent) => void;

/** Response from a maker's pricing callback */
export interface QuoteResponse {
  amountIn: bigint;
  amountOut: bigint;
}
