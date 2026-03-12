/**
 * WebSocket client pool — manages connections to the alert-stream service.
 *
 * One WebSocket per unique agentId, shared across all Telegram users
 * linked to that agent. Alert-stream handles ACL enforcement server-side;
 * the bot applies per-user client-side narrowing before delivery.
 */

import WebSocket from "ws";
import {
  getAllUsers,
  getUsersByAgent,
  decryptUserApiKey,
  getUser,
} from "./store.js";
import { formatAlert } from "./formatter.js";
import { queueAlert } from "./telegram.js";
import type {
  AgentConnection,
  AlertPayload,
  AlertSubscription,
  AlertEventType,
  LinkedUser,
  WsServerMessage,
} from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ALERT_STREAM_URL =
  process.env.ALERT_STREAM_URL ?? "ws://127.0.0.1:8090";
const BASE_RECONNECT_MS = 2_000;
const MAX_RECONNECT_MS = 30_000;
const PING_INTERVAL_MS = 25_000; // slightly under alert-stream's 30s

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const agentConnections = new Map<string, AgentConnection>();

// Session-scoped delivery counter per user
const userAlertCounts = new Map<string, number>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize all WebSocket connections from stored linked users.
 * Called on bot startup after the store is initialized.
 */
export function initConnections(): void {
  const users = getAllUsers();
  const agentGroups = new Map<string, LinkedUser[]>();

  for (const user of users) {
    if (!agentGroups.has(user.agentId)) {
      agentGroups.set(user.agentId, []);
    }
    agentGroups.get(user.agentId)!.push(user);
  }

  for (const [agentId, groupUsers] of agentGroups) {
    // Use the first user's encrypted key (all share the same agent)
    const firstUser = groupUsers[0];
    let apiKey: string;
    try {
      apiKey = decryptUserApiKey(firstUser);
    } catch (err) {
      console.error(
        `[alertStream] Failed to decrypt key for agent ${agentId.slice(0, 8)}:`,
        err
      );
      continue;
    }

    const conn: AgentConnection = {
      agentId,
      wallet: firstUser.agentWallet,
      ws: null,
      status: "disconnected",
      reconnectAttempts: 0,
      apiKeyEncrypted: {
        ciphertext: firstUser.apiKeyEncrypted,
        iv: firstUser.apiKeyIv,
        tag: firstUser.apiKeyTag,
      },
      linkedUsers: new Set(groupUsers.map((u) => u.telegramUserId)),
      subscription: computeUnionSubscription(groupUsers),
      lastEventSequence: 0,
    };

    agentConnections.set(agentId, conn);
    connectAgent(conn, apiKey);
  }

  console.log(
    `[alertStream] Initialized ${agentConnections.size} agent connection(s)`
  );
}

/**
 * Open or reuse a connection for an agent after a new user links.
 */
export function ensureConnection(
  agentId: string,
  telegramUserId: string,
  apiKey: string,
  wallet: string,
  encrypted: { ciphertext: string; iv: string; tag: string }
): void {
  const existing = agentConnections.get(agentId);

  if (existing) {
    existing.linkedUsers.add(telegramUserId);
    // Recompute union subscription with the new user
    const users = getUsersByAgent(agentId);
    existing.subscription = computeUnionSubscription(users);

    // Update subscription on the active WS
    if (existing.ws?.readyState === WebSocket.OPEN && existing.status === "authenticated") {
      sendSubscribe(existing);
    }
    return;
  }

  // New connection
  const conn: AgentConnection = {
    agentId,
    wallet: wallet.toLowerCase(),
    ws: null,
    status: "disconnected",
    reconnectAttempts: 0,
    apiKeyEncrypted: encrypted,
    linkedUsers: new Set([telegramUserId]),
    subscription: computeUnionSubscription(getUsersByAgent(agentId)),
    lastEventSequence: 0,
  };

  agentConnections.set(agentId, conn);
  connectAgent(conn, apiKey);
}

/**
 * Remove a user from their agent's connection. Closes WS if no users remain.
 */
export function removeUserFromConnection(
  agentId: string,
  telegramUserId: string
): void {
  const conn = agentConnections.get(agentId);
  if (!conn) return;

  conn.linkedUsers.delete(telegramUserId);
  userAlertCounts.delete(telegramUserId);

  if (conn.linkedUsers.size === 0) {
    // No more users — close connection
    if (conn.ws) {
      conn.status = "disconnected";
      conn.ws.close(1000, "No linked users");
      conn.ws = null;
    }
    agentConnections.delete(agentId);
    console.log(
      `[alertStream] Closed connection for agent ${agentId.slice(0, 8)} (no linked users)`
    );
    return;
  }

  // Recompute subscription with remaining users
  const users = getUsersByAgent(agentId);
  conn.subscription = computeUnionSubscription(users);
  if (conn.ws?.readyState === WebSocket.OPEN && conn.status === "authenticated") {
    sendSubscribe(conn);
  }
}

/**
 * Recompute and update the subscription for an agent's connection.
 * Called after a user changes their filter preferences.
 */
export function refreshSubscription(agentId: string): void {
  const conn = agentConnections.get(agentId);
  if (!conn) return;

  const users = getUsersByAgent(agentId);
  conn.subscription = computeUnionSubscription(users);

  if (conn.ws?.readyState === WebSocket.OPEN && conn.status === "authenticated") {
    sendSubscribe(conn);
  }
}

/**
 * Get the connection status for an agent.
 */
export function getConnectionStatus(
  agentId: string
): AgentConnection["status"] | "not_connected" {
  return agentConnections.get(agentId)?.status ?? "not_connected";
}

/**
 * Get session alert count for a user.
 */
export function getUserAlertCount(telegramUserId: string): number {
  return userAlertCounts.get(telegramUserId) ?? 0;
}

/**
 * Close all connections (used during shutdown).
 */
export function closeAllConnections(): void {
  for (const [, conn] of agentConnections) {
    conn.status = "disconnected";
    if (conn.ws) {
      conn.ws.close(1000, "Bot shutting down");
      conn.ws = null;
    }
  }
  agentConnections.clear();
}

/**
 * Get stats for the health endpoint.
 */
export function getStreamStats(): {
  totalConnections: number;
  authenticated: number;
  disconnected: number;
  linkedUsers: number;
} {
  let authenticated = 0;
  let disconnected = 0;
  let linkedUsers = 0;

  for (const [, conn] of agentConnections) {
    if (conn.status === "authenticated") authenticated++;
    if (conn.status === "disconnected") disconnected++;
    linkedUsers += conn.linkedUsers.size;
  }

  return {
    totalConnections: agentConnections.size,
    authenticated,
    disconnected,
    linkedUsers,
  };
}

// ---------------------------------------------------------------------------
// WebSocket connection lifecycle
// ---------------------------------------------------------------------------

function connectAgent(conn: AgentConnection, apiKey: string): void {
  conn.status = "connecting";

  const ws = new WebSocket(ALERT_STREAM_URL);
  conn.ws = ws;

  let pingTimer: ReturnType<typeof setInterval> | null = null;

  ws.on("open", () => {
    console.log(
      `[alertStream] Connected to alert-stream for agent ${conn.agentId.slice(0, 8)}`
    );
    conn.reconnectAttempts = 0;

    // Send AUTHENTICATE
    ws.send(
      JSON.stringify({
        type: "AUTHENTICATE",
        data: { token: apiKey },
      })
    );

    // Start keepalive pings
    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "PING", data: {} }));
      }
    }, PING_INTERVAL_MS);
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString()) as WsServerMessage;
      handleServerMessage(conn, msg);
    } catch (err) {
      console.error("[alertStream] Failed to parse message:", err);
    }
  });

  ws.on("close", (code, reason) => {
    if (pingTimer) clearInterval(pingTimer);
    conn.ws = null;

    // Don't reconnect if intentionally disconnected
    if (conn.status === "disconnected") return;

    conn.status = "disconnected";
    console.log(
      `[alertStream] Disconnected from alert-stream for agent ${conn.agentId.slice(0, 8)} ` +
        `(code: ${code}, reason: ${reason.toString()})`
    );

    scheduleReconnect(conn, apiKey);
  });

  ws.on("error", (err) => {
    if (pingTimer) clearInterval(pingTimer);
    console.error(
      `[alertStream] WS error for agent ${conn.agentId.slice(0, 8)}:`,
      err.message
    );
    // on("close") will fire after this — reconnect handled there
  });
}

function scheduleReconnect(conn: AgentConnection, apiKey: string): void {
  // Don't reconnect if the agent has been removed
  if (!agentConnections.has(conn.agentId)) return;

  conn.reconnectAttempts++;
  const delay = Math.min(
    BASE_RECONNECT_MS * 2 ** (conn.reconnectAttempts - 1),
    MAX_RECONNECT_MS
  );

  console.log(
    `[alertStream] Reconnecting agent ${conn.agentId.slice(0, 8)} in ${delay}ms ` +
      `(attempt ${conn.reconnectAttempts})`
  );

  setTimeout(() => {
    // Double-check the agent still exists
    if (agentConnections.has(conn.agentId) && conn.status === "disconnected") {
      connectAgent(conn, apiKey);
    }
  }, delay);
}

// ---------------------------------------------------------------------------
// Server message handling
// ---------------------------------------------------------------------------

function handleServerMessage(
  conn: AgentConnection,
  msg: WsServerMessage
): void {
  switch (msg.type) {
    case "AUTHENTICATED": {
      conn.status = "authenticated";
      console.log(
        `[alertStream] Agent ${conn.agentId.slice(0, 8)} authenticated ` +
          `(wallet: ${conn.wallet.slice(0, 10)}...)`
      );
      // Send our computed subscription
      sendSubscribe(conn);
      break;
    }

    case "SUBSCRIBED": {
      // Subscription confirmed by alert-stream
      break;
    }

    case "ALERT": {
      const alert = msg.data as AlertPayload;
      conn.lastEventSequence = alert.sequence;
      deliverToUsers(conn, alert);
      break;
    }

    case "PONG": {
      // Keepalive acknowledged
      break;
    }

    case "ERROR": {
      const error = msg.data as { code: string; message: string };
      console.error(
        `[alertStream] Error for agent ${conn.agentId.slice(0, 8)}: ` +
          `${error.code} — ${error.message}`
      );

      if (error.code === "AUTH_FAILED" || error.code === "MAX_CONNECTIONS") {
        // Don't reconnect on auth failures — the token is invalid
        conn.status = "disconnected";
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Per-user delivery
// ---------------------------------------------------------------------------

function deliverToUsers(conn: AgentConnection, alert: AlertPayload): void {
  const users = getUsersByAgent(conn.agentId);

  for (const user of users) {
    if (!conn.linkedUsers.has(user.telegramUserId)) continue;
    if (!shouldDeliverToUser(alert, user)) continue;

    const html = formatAlert(alert);
    queueAlert(user.telegramUserId, html);

    // Increment session counter
    userAlertCounts.set(
      user.telegramUserId,
      (userAlertCounts.get(user.telegramUserId) ?? 0) + 1
    );
  }
}

/**
 * Per-user client-side filter. Narrows what alert-stream already delivered
 * to this agent based on individual user preferences.
 */
function shouldDeliverToUser(
  alert: AlertPayload,
  user: LinkedUser
): boolean {
  if (!user.alertsEnabled) return false;

  // Event type filter
  if (!user.filterEventTypes.includes(alert.eventType)) return false;

  // Visibility filter
  if (
    user.filterVisibility !== "all" &&
    user.filterVisibility !== alert.visibility
  ) {
    return false;
  }

  // Token filter (only when tokens array is non-empty)
  if (user.filterTokens.length > 0) {
    const tokenSet = new Set(
      user.filterTokens.map((t) => t.toLowerCase())
    );

    const rfq = alert.rfq;
    const inMatch = tokenSet.has(rfq.tokenIn.address.toLowerCase());
    const outMatch = tokenSet.has(rfq.tokenOut.address.toLowerCase());

    if (!inMatch && !outMatch) return false;

    // Side filter (only when token filter active)
    if (user.filterSide === "buy" && !outMatch) return false;
    if (user.filterSide === "sell" && !inMatch) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Union subscription computation
// ---------------------------------------------------------------------------

function computeUnionSubscription(
  users: LinkedUser[]
): AlertSubscription {
  const active = users.filter((u) => u.alertsEnabled);

  if (active.length === 0) {
    return {
      tokens: [],
      minNotionalUsd: 0,
      visibility: "all",
      side: "all",
      eventTypes: [],
    };
  }

  // Tokens: union. If any user has empty (all tokens), result is empty (all).
  const hasWildcard = active.some((u) => u.filterTokens.length === 0);
  const tokens = hasWildcard
    ? []
    : [...new Set(active.flatMap((u) => u.filterTokens))];

  // Visibility: if any wants "all", or both "public" and "private" present → "all"
  const visSet = new Set(active.map((u) => u.filterVisibility));
  const visibility =
    visSet.has("all") || (visSet.has("public") && visSet.has("private"))
      ? "all"
      : (visSet.values().next().value as AlertSubscription["visibility"]);

  // Side: same union logic
  const sideSet = new Set(active.map((u) => u.filterSide));
  const side =
    sideSet.has("all") || (sideSet.has("buy") && sideSet.has("sell"))
      ? "all"
      : (sideSet.values().next().value as AlertSubscription["side"]);

  // Event types: union
  const eventTypes = [
    ...new Set(active.flatMap((u) => u.filterEventTypes)),
  ] as AlertEventType[];

  // Min notional: minimum across all users (broadest)
  const minNotionalUsd = Math.min(
    ...active.map((u) => u.filterMinUsd)
  );

  return { tokens, minNotionalUsd, visibility, side, eventTypes };
}

// ---------------------------------------------------------------------------
// WS send helpers
// ---------------------------------------------------------------------------

function sendSubscribe(conn: AgentConnection): void {
  if (!conn.ws || conn.ws.readyState !== WebSocket.OPEN) return;

  conn.ws.send(
    JSON.stringify({
      type: "SUBSCRIBE",
      data: conn.subscription,
    })
  );
}
