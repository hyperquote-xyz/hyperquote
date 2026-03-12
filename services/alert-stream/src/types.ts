/**
 * Type definitions for the HyperQuote Alert Stream service.
 */

import { WebSocket } from "ws";

// ---------------------------------------------------------------------------
// Internal feed events (received from Next.js internal SSE)
// ---------------------------------------------------------------------------

export type FeedEventType =
  | "rfq.created"
  | "rfq.quoted"
  | "rfq.filled"
  | "rfq.cancelled"
  | "rfq.expired";

export type FeedRfqStatus = "OPEN" | "QUOTED" | "FILLED" | "EXPIRED" | "KILLED";

/** Token info as emitted by rfqRegistry */
export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
  name?: string;
  logo?: string;
}

/** RFQ data as emitted by rfqRegistry */
export interface RFQData {
  id: string;
  taker?: string;
  tokenIn: TokenInfo;
  tokenOut: TokenInfo;
  kind: number; // 0 = EXACT_IN, 1 = EXACT_OUT
  amountIn?: string | null;
  amountOut?: string | null;
  expiry: number;
  createdAt: number;
  allowedMakers?: string[];
  [key: string]: unknown;
}

/** Internal feed event — includes private RFQ metadata */
export interface InternalFeedEvent {
  type: FeedEventType;
  rfqId: string;
  data: RFQData;
  status: FeedRfqStatus;
  quoteCount?: number;
  fillTxHash?: string;
  timestamp: number;
  visibility: "public" | "private";
  allowedMakers?: string[];
}

// ---------------------------------------------------------------------------
// Alert subscription (per-client filter state)
// ---------------------------------------------------------------------------

/** Alertable event types (subset of FeedEventType for subscription) */
export type AlertEventType = "rfq.created" | "rfq.filled";

export interface AlertSubscription {
  tokens: string[]; // lowercase 0x addresses; empty = all tokens
  minNotionalUsd: number;
  visibility: "all" | "public" | "private";
  side: "all" | "buy" | "sell";
  eventTypes: AlertEventType[];
}

export const DEFAULT_SUBSCRIPTION: AlertSubscription = {
  tokens: [],
  minNotionalUsd: 0,
  visibility: "all",
  side: "all",
  eventTypes: ["rfq.created", "rfq.filled"],
};

// ---------------------------------------------------------------------------
// WebSocket client state
// ---------------------------------------------------------------------------

export interface AlertClient {
  ws: WebSocket;
  agentId: string;
  wallet: string; // lowercase
  roles: string[];
  subscription: AlertSubscription;
  subscribed: boolean; // false if UNSUBSCRIBE was sent
  lastPong: number; // timestamp (ms) of last pong/activity
  ip: string;
}

// ---------------------------------------------------------------------------
// WebSocket message protocol
// ---------------------------------------------------------------------------

// Client → Server message types
export type ClientMessageType =
  | "AUTHENTICATE"
  | "SUBSCRIBE"
  | "UNSUBSCRIBE"
  | "PING";

export interface ClientMessage {
  type: ClientMessageType;
  data?: unknown;
}

export interface AuthenticateData {
  token: string; // hq_live_...
}

export interface SubscribeData {
  tokens?: string[];
  minNotionalUsd?: number;
  visibility?: "all" | "public" | "private";
  side?: "all" | "buy" | "sell";
  eventTypes?: AlertEventType[];
}

// Server → Client message types
export type ServerMessageType =
  | "AUTHENTICATED"
  | "SUBSCRIBED"
  | "ALERT"
  | "PONG"
  | "ERROR";

export interface ServerMessage {
  type: ServerMessageType;
  data: unknown;
}

export interface AuthenticatedData {
  agentId: string;
  wallet: string;
  roles: string[];
  subscription: AlertSubscription;
}

// Error codes
export type AlertErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_FAILED"
  | "AUTH_TIMEOUT"
  | "RATE_LIMITED"
  | "INVALID_MESSAGE"
  | "MAX_CONNECTIONS"
  | "INTERNAL_ERROR";

export interface AlertErrorData {
  code: AlertErrorCode;
  message: string;
}

// ---------------------------------------------------------------------------
// Normalized alert payloads
// ---------------------------------------------------------------------------

/** Common fields present on every alert payload */
export interface AlertBase {
  /** Monotonic sequence number — increments per alert emission during service lifetime */
  sequence: number;
  /** Deterministic event identifier: `<eventType>:<rfqId>` (e.g. `rfq.created:550e8400-...`) */
  eventId: string;
  rfqId: string;
  timestamp: number;
  visibility: "public" | "private";
}

export interface AlertRfqCreated extends AlertBase {
  eventType: "rfq.created";
  rfq: {
    id: string;
    taker?: string;
    tokenIn: TokenInfo;
    tokenOut: TokenInfo;
    kind: number;
    amountIn?: string | null;
    amountOut?: string | null;
    expiry: number;
    createdAt: number;
  };
  quoteCount: number;
}

export interface AlertRfqFilled extends AlertBase {
  eventType: "rfq.filled";
  rfq: {
    id: string;
    taker?: string;
    tokenIn: TokenInfo;
    tokenOut: TokenInfo;
    kind: number;
    amountIn?: string | null;
    amountOut?: string | null;
    expiry: number;
    createdAt: number;
  };
  fill: {
    txHash?: string;
    filledAt: number;
  };
}

export type AlertPayload = AlertRfqCreated | AlertRfqFilled;

// ---------------------------------------------------------------------------
// Auth result (from Next.js API validation)
// ---------------------------------------------------------------------------

export interface AgentAuthInfo {
  id: string;
  name: string;
  owner: string;
  wallet: string;
  roles: string[];
}

export interface AlertPreferencesResponse {
  agentId: string;
  enabled: boolean;
  tokens: string[];
  minNotionalUsd: number;
  visibility: "all" | "public" | "private";
  side: "all" | "buy" | "sell";
  eventTypes: string[];
}
