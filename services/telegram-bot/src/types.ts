/**
 * Type definitions for the HyperQuote Telegram Alert Bot.
 *
 * Alert payload types mirror those from @hyperquote/alert-stream.
 * We redefine them here instead of importing to keep the service standalone.
 */

// ---------------------------------------------------------------------------
// Token info (matches alert-stream TokenInfo)
// ---------------------------------------------------------------------------

export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
  name?: string;
  logo?: string;
}

// ---------------------------------------------------------------------------
// Alert payloads (matches alert-stream normalized payloads)
// ---------------------------------------------------------------------------

export type AlertEventType = "rfq.created" | "rfq.filled";

export interface AlertBase {
  sequence: number;
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
    kind: number; // 0 = EXACT_IN, 1 = EXACT_OUT
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
// Alert subscription (mirrors alert-stream subscription shape)
// ---------------------------------------------------------------------------

export interface AlertSubscription {
  tokens: string[];
  minNotionalUsd: number;
  visibility: "all" | "public" | "private";
  side: "all" | "buy" | "sell";
  eventTypes: AlertEventType[];
}

// ---------------------------------------------------------------------------
// WebSocket protocol messages (client sends to alert-stream)
// ---------------------------------------------------------------------------

export interface WsAuthenticateMessage {
  type: "AUTHENTICATE";
  data: { token: string };
}

export interface WsSubscribeMessage {
  type: "SUBSCRIBE";
  data: Partial<AlertSubscription>;
}

export interface WsUnsubscribeMessage {
  type: "UNSUBSCRIBE";
  data: Record<string, never>;
}

export interface WsPingMessage {
  type: "PING";
  data: Record<string, never>;
}

export type WsClientMessage =
  | WsAuthenticateMessage
  | WsSubscribeMessage
  | WsUnsubscribeMessage
  | WsPingMessage;

// ---------------------------------------------------------------------------
// WebSocket protocol messages (alert-stream sends to clients)
// ---------------------------------------------------------------------------

export interface WsAuthenticatedMessage {
  type: "AUTHENTICATED";
  data: {
    agentId: string;
    wallet: string;
    roles: string[];
    subscription: AlertSubscription;
  };
}

export interface WsSubscribedMessage {
  type: "SUBSCRIBED";
  data: AlertSubscription & { paused?: boolean };
}

export interface WsAlertMessage {
  type: "ALERT";
  data: AlertPayload;
}

export interface WsPongMessage {
  type: "PONG";
  data: Record<string, never>;
}

export interface WsErrorMessage {
  type: "ERROR";
  data: {
    code: string;
    message: string;
  };
}

export type WsServerMessage =
  | WsAuthenticatedMessage
  | WsSubscribedMessage
  | WsAlertMessage
  | WsPongMessage
  | WsErrorMessage;

// ---------------------------------------------------------------------------
// Agent auth info (returned by /api/v1/agent/auth)
// ---------------------------------------------------------------------------

export interface AgentAuthInfo {
  id: string;
  name: string;
  owner: string;
  wallet: string;
  roles: string[];
}

// ---------------------------------------------------------------------------
// Linked user (SQLite row)
// ---------------------------------------------------------------------------

export interface LinkedUser {
  telegramUserId: string;
  telegramUsername: string | null;
  agentId: string;
  agentWallet: string;
  apiKeyEncrypted: string;
  apiKeyIv: string;
  apiKeyTag: string;
  filterTokens: string[];      // parsed from JSON
  filterMinUsd: number;
  filterVisibility: "all" | "public" | "private";
  filterSide: "all" | "buy" | "sell";
  filterEventTypes: AlertEventType[];
  alertsEnabled: boolean;
  linkedAt: string;
  updatedAt: string;
}

/** Raw row from SQLite before parsing JSON fields */
export interface LinkedUserRow {
  telegram_user_id: string;
  telegram_username: string | null;
  agent_id: string;
  agent_wallet: string;
  api_key_encrypted: string;
  api_key_iv: string;
  api_key_tag: string;
  filter_tokens: string;       // JSON string
  filter_min_usd: number;
  filter_visibility: string;
  filter_side: string;
  filter_event_types: string;  // JSON string
  alerts_enabled: number;      // 0 or 1
  linked_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Agent connection (in-memory WS pool state)
// ---------------------------------------------------------------------------

export interface AgentConnection {
  agentId: string;
  wallet: string;
  ws: import("ws").WebSocket | null;
  status: "connecting" | "authenticated" | "disconnected";
  reconnectAttempts: number;
  apiKeyEncrypted: { ciphertext: string; iv: string; tag: string };
  linkedUsers: Set<string>;      // Telegram user IDs on this agent
  subscription: AlertSubscription;
  lastEventSequence: number;
}

// ---------------------------------------------------------------------------
// Encrypted key material
// ---------------------------------------------------------------------------

export interface EncryptedKey {
  ciphertext: string; // base64
  iv: string;         // hex
  tag: string;        // hex
}
