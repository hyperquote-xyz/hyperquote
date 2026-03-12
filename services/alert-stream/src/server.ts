/**
 * HyperQuote Alert Stream — WebSocket server.
 *
 * Connects to the Next.js internal SSE feed, authenticates agent clients,
 * applies per-client subscription filters, and delivers normalized alerts.
 *
 * Run: npx tsx src/server.ts
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { WebSocketServer, WebSocket } from "ws";
import {
  validateAgentToken,
  fetchAlertPreferences,
  preferencesToSubscription,
} from "./auth.js";
import { shouldDeliverEvent, mergeSubscription } from "./subscription.js";
import {
  startEventSource,
  stopEventSource,
  isEventSourceConnected,
  getReconnectCount,
} from "./eventSource.js";
import type {
  AlertClient,
  ClientMessage,
  AuthenticateData,
  SubscribeData,
  InternalFeedEvent,
  AlertPayload,
  AlertRfqCreated,
  AlertRfqFilled,
} from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.ALERT_STREAM_PORT ?? "8090");
const MAX_CONNECTIONS_PER_AGENT = parseInt(
  process.env.MAX_CONNECTIONS_PER_AGENT ?? "5"
);
const AUTH_TIMEOUT_MS = 10_000;
const PING_INTERVAL_MS = 30_000;
const STALE_TIMEOUT_MS = 90_000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const clients = new Map<WebSocket, AlertClient>();
// Track connections per agent for limit enforcement
const agentConnections = new Map<string, Set<WebSocket>>();

/**
 * Global monotonic sequence counter — increments for every ALERT emitted
 * to any client during the lifetime of this service process. Resets on restart.
 * Used by clients for gap detection and ordering.
 */
let globalSequence = 0;

// ---------------------------------------------------------------------------
// Observability counters — lightweight in-memory metrics
// ---------------------------------------------------------------------------

/** Non-alertable event types — received on the internal SSE but not forwarded to WS clients */
const NON_ALERTABLE_EVENTS = new Set(["rfq.quoted", "rfq.cancelled", "rfq.expired"]);

const metrics = {
  // Lifetime counters (never reset)
  eventsReceived: 0, // total internal SSE events received
  eventsDropped: 0, // non-alertable events (rfq.quoted, rfq.cancelled, rfq.expired)
  alertsDelivered: 0, // total ALERT messages sent to clients
  alertsFiltered: 0, // total events that didn't pass filters (per-client)
  aclRejections: 0, // private RFQ events blocked by ACL check
  authSuccesses: 0,
  authFailures: 0,
  authTimeouts: 0,
  connectionsOpened: 0,
  connectionsClosed: 0,
  staleDisconnects: 0,
  maxConnRejections: 0,
  // Per event-type delivery counters
  deliveredByType: {
    "rfq.created": 0,
    "rfq.filled": 0,
  } as Record<string, number>,
  // SSE reconnect tracking
  sseReconnects: 0,
  startedAt: Date.now(),
};

// ---------------------------------------------------------------------------
// WebSocket helpers
// ---------------------------------------------------------------------------

function sendJson(ws: WebSocket, type: string, data: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, data }));
  }
}

function sendError(
  ws: WebSocket,
  code: string,
  message: string
): void {
  sendJson(ws, "ERROR", { code, message });
}

function removeClient(ws: WebSocket): void {
  const client = clients.get(ws);
  if (client) {
    // Remove from agent connection tracking
    const agentSockets = agentConnections.get(client.agentId);
    if (agentSockets) {
      agentSockets.delete(ws);
      if (agentSockets.size === 0) {
        agentConnections.delete(client.agentId);
      }
    }
  }
  clients.delete(ws);
}

// ---------------------------------------------------------------------------
// Normalize internal events to alert payloads
// ---------------------------------------------------------------------------

/**
 * Build a deterministic event identifier: `<eventType>:<rfqId>`
 * Stable across service restarts — same RFQ event always produces the same id.
 */
function buildEventId(eventType: string, rfqId: string): string {
  return `${eventType}:${rfqId}`;
}

function normalizeAlert(
  event: InternalFeedEvent,
  sequence: number
): AlertPayload | null {
  const rfqBase = {
    id: event.data.id ?? event.rfqId,
    taker: event.data.taker,
    tokenIn: event.data.tokenIn,
    tokenOut: event.data.tokenOut,
    kind: event.data.kind,
    amountIn: event.data.amountIn,
    amountOut: event.data.amountOut,
    expiry: event.data.expiry,
    createdAt: event.data.createdAt,
  };

  const eventId = buildEventId(event.type, event.rfqId);

  switch (event.type) {
    case "rfq.created":
      return {
        eventType: "rfq.created",
        sequence,
        eventId,
        rfqId: event.rfqId,
        timestamp: event.timestamp,
        visibility: event.visibility,
        rfq: rfqBase,
        quoteCount: event.quoteCount ?? 0,
      } satisfies AlertRfqCreated;

    case "rfq.filled":
      return {
        eventType: "rfq.filled",
        sequence,
        eventId,
        rfqId: event.rfqId,
        timestamp: event.timestamp,
        visibility: event.visibility,
        rfq: rfqBase,
        fill: {
          txHash: event.fillTxHash,
          filledAt: event.timestamp,
        },
      } satisfies AlertRfqFilled;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Internal event handler — called for every event from the SSE source
// ---------------------------------------------------------------------------

function handleInternalEvent(event: InternalFeedEvent): void {
  metrics.eventsReceived++;

  // Early drop: non-alertable event types never reach clients.
  // rfq.quoted, rfq.cancelled, rfq.expired are internal-only — they travel
  // over the internal SSE for future use but are NOT exposed to WS clients.
  if (NON_ALERTABLE_EVENTS.has(event.type)) {
    metrics.eventsDropped++;
    return;
  }

  // Iterate all authenticated clients and check filters.
  // Each delivery gets its own monotonic sequence number so clients can
  // detect gaps and maintain ordering. The sequence increments per-send,
  // not per-event, so two clients receiving the same event will see
  // different sequence numbers.
  for (const [ws, client] of clients) {
    if (!client.agentId) continue; // Not yet authenticated

    const result = shouldDeliverEvent(event, client);
    if (result === true) {
      // Increment sequence and normalize with this delivery's sequence number
      const seq = ++globalSequence;
      const alert = normalizeAlert(event, seq);
      if (!alert) continue; // Defensive

      sendJson(ws, "ALERT", alert);
      metrics.alertsDelivered++;
      metrics.deliveredByType[alert.eventType] =
        (metrics.deliveredByType[alert.eventType] ?? 0) + 1;
    } else if (result === "acl_rejected") {
      metrics.aclRejections++;
      metrics.alertsFiltered++;
    } else {
      metrics.alertsFiltered++;
    }
  }
}

// ---------------------------------------------------------------------------
// WebSocket message handler
// ---------------------------------------------------------------------------

async function handleMessage(
  ws: WebSocket,
  raw: string,
  ip: string
): Promise<void> {
  let msg: ClientMessage;
  try {
    msg = JSON.parse(raw);
  } catch {
    sendError(ws, "INVALID_MESSAGE", "Invalid JSON");
    return;
  }

  if (!msg.type) {
    sendError(ws, "INVALID_MESSAGE", "Missing message type");
    return;
  }

  const client = clients.get(ws);

  switch (msg.type) {
    case "AUTHENTICATE": {
      if (client?.agentId) {
        sendError(ws, "INVALID_MESSAGE", "Already authenticated");
        return;
      }

      const authData = msg.data as AuthenticateData | undefined;
      if (!authData?.token) {
        sendError(ws, "AUTH_FAILED", "Missing token");
        return;
      }

      // Validate token against Next.js API
      const agentInfo = await validateAgentToken(authData.token);
      if (!agentInfo) {
        metrics.authFailures++;
        sendError(ws, "AUTH_FAILED", "Invalid or expired API key");
        ws.close(4001, "Authentication failed");
        return;
      }

      // Check per-agent connection limit
      const existingConns = agentConnections.get(agentInfo.id);
      if (existingConns && existingConns.size >= MAX_CONNECTIONS_PER_AGENT) {
        metrics.maxConnRejections++;
        sendError(
          ws,
          "MAX_CONNECTIONS",
          `Maximum ${MAX_CONNECTIONS_PER_AGENT} connections per agent`
        );
        ws.close(4002, "Max connections exceeded");
        return;
      }

      // Fetch stored preferences as default subscription
      const prefs = await fetchAlertPreferences(authData.token);
      const subscription = preferencesToSubscription(prefs);

      metrics.authSuccesses++;

      // Register the client
      const alertClient: AlertClient = {
        ws,
        agentId: agentInfo.id,
        wallet: agentInfo.wallet.toLowerCase(),
        roles: agentInfo.roles,
        subscription,
        subscribed: true,
        lastPong: Date.now(),
        ip,
      };
      clients.set(ws, alertClient);

      // Track per-agent connections
      if (!agentConnections.has(agentInfo.id)) {
        agentConnections.set(agentInfo.id, new Set());
      }
      agentConnections.get(agentInfo.id)!.add(ws);

      console.log(
        `[WS] Agent ${agentInfo.id.slice(0, 8)}... authenticated ` +
          `(wallet: ${agentInfo.wallet.slice(0, 10)}..., conns: ${agentConnections.get(agentInfo.id)!.size})`
      );

      sendJson(ws, "AUTHENTICATED", {
        agentId: agentInfo.id,
        wallet: agentInfo.wallet,
        roles: agentInfo.roles,
        subscription,
      });
      break;
    }

    case "SUBSCRIBE": {
      if (!client?.agentId) {
        sendError(ws, "AUTH_REQUIRED", "Authenticate first");
        return;
      }

      const subData = msg.data as SubscribeData | undefined;
      if (!subData || typeof subData !== "object") {
        sendError(ws, "INVALID_MESSAGE", "Invalid subscription data");
        return;
      }

      // Merge partial update into current subscription
      client.subscription = mergeSubscription(
        client.subscription,
        subData
      );
      client.subscribed = true;

      sendJson(ws, "SUBSCRIBED", client.subscription);
      break;
    }

    case "UNSUBSCRIBE": {
      if (!client?.agentId) {
        sendError(ws, "AUTH_REQUIRED", "Authenticate first");
        return;
      }

      client.subscribed = false;
      sendJson(ws, "SUBSCRIBED", {
        ...client.subscription,
        paused: true,
      });
      break;
    }

    case "PING": {
      if (client) {
        client.lastPong = Date.now();
      }
      sendJson(ws, "PONG", {});
      break;
    }

    default:
      sendError(ws, "INVALID_MESSAGE", `Unknown message type: ${msg.type}`);
  }
}

// ---------------------------------------------------------------------------
// HTTP handler (health endpoint)
// ---------------------------------------------------------------------------

function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === "/health") {
    const authenticatedClients = Array.from(clients.values()).filter(
      (c) => c.agentId
    );

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        eventSourceConnected: isEventSourceConnected(),
        connectedClients: clients.size,
        authenticatedClients: authenticatedClients.length,
        uniqueAgents: agentConnections.size,
        uptime: Math.floor(process.uptime()),
      })
    );
    return;
  }

  // Detailed debug stats — shows all observability counters
  if (url.pathname === "/debug/stats") {
    const now = Date.now();
    const authenticatedClients = Array.from(clients.values()).filter(
      (c) => c.agentId
    );

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        uptime: Math.floor(process.uptime()),
        startedAt: new Date(metrics.startedAt).toISOString(),
        connections: {
          current: clients.size,
          authenticated: authenticatedClients.length,
          uniqueAgents: agentConnections.size,
          lifetime: {
            opened: metrics.connectionsOpened,
            closed: metrics.connectionsClosed,
            staleDisconnects: metrics.staleDisconnects,
          },
        },
        auth: {
          successes: metrics.authSuccesses,
          failures: metrics.authFailures,
          timeouts: metrics.authTimeouts,
          maxConnRejections: metrics.maxConnRejections,
        },
        events: {
          received: metrics.eventsReceived,
          dropped: metrics.eventsDropped,
          alertsDelivered: metrics.alertsDelivered,
          alertsFiltered: metrics.alertsFiltered,
          aclRejections: metrics.aclRejections,
          deliveredByType: metrics.deliveredByType,
          currentSequence: globalSequence,
        },
        eventSource: {
          connected: isEventSourceConnected(),
          reconnects: getReconnectCount(),
        },
      })
    );
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      error: "Not found. Endpoints: /health, /debug/stats, ws://",
    })
  );
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = createServer(handleHttp);
const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
    req.socket.remoteAddress ??
    "unknown";

  metrics.connectionsOpened++;
  console.log(`[WS] Client connected from ${ip} (total: ${clients.size + 1})`);

  // Create a placeholder client (not yet authenticated)
  const placeholder: AlertClient = {
    ws,
    agentId: "",
    wallet: "",
    roles: [],
    subscription: {
      tokens: [],
      minNotionalUsd: 0,
      visibility: "all",
      side: "all",
      eventTypes: ["rfq.created", "rfq.filled"],
    },
    subscribed: false,
    lastPong: Date.now(),
    ip,
  };
  clients.set(ws, placeholder);

  // Auth timeout — disconnect if not authenticated within 10s
  const authTimeout = setTimeout(() => {
    const client = clients.get(ws);
    if (client && !client.agentId) {
      metrics.authTimeouts++;
      sendError(ws, "AUTH_TIMEOUT", "Authentication required within 10 seconds");
      ws.close(4003, "Auth timeout");
      removeClient(ws);
    }
  }, AUTH_TIMEOUT_MS);

  ws.on("message", (data) => {
    handleMessage(ws, data.toString(), ip);
  });

  ws.on("close", () => {
    clearTimeout(authTimeout);
    metrics.connectionsClosed++;
    const client = clients.get(ws);
    const agentLabel = client?.agentId
      ? `agent ${client.agentId.slice(0, 8)}...`
      : "unauthenticated";
    console.log(
      `[WS] Client disconnected (${agentLabel}, total: ${clients.size - 1})`
    );
    removeClient(ws);
  });

  ws.on("error", (err) => {
    console.error(`[WS ERROR] ${ip}:`, err.message);
    clearTimeout(authTimeout);
    removeClient(ws);
  });
});

// ---------------------------------------------------------------------------
// Keep-alive ping + stale client cleanup
// ---------------------------------------------------------------------------

setInterval(() => {
  const now = Date.now();
  for (const [ws, client] of clients) {
    // Disconnect stale clients
    if (client.agentId && now - client.lastPong > STALE_TIMEOUT_MS) {
      metrics.staleDisconnects++;
      console.log(
        `[WS] Disconnecting stale client: agent ${client.agentId.slice(0, 8)}...`
      );
      ws.close(4004, "Stale connection");
      removeClient(ws);
      continue;
    }

    // Send ping
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }
}, PING_INTERVAL_MS);

// Handle pong responses to update lastPong
wss.on("connection", (ws) => {
  ws.on("pong", () => {
    const client = clients.get(ws);
    if (client) {
      client.lastPong = Date.now();
    }
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

server.listen(PORT, () => {
  console.log("=== HyperQuote Alert Stream ===");
  console.log(`  WebSocket: ws://127.0.0.1:${PORT}`);
  console.log(`  Health:    http://127.0.0.1:${PORT}/health`);
  console.log(`  Max conns/agent: ${MAX_CONNECTIONS_PER_AGENT}`);
  console.log(`  Auth timeout: ${AUTH_TIMEOUT_MS / 1000}s`);
  console.log(`  Ping interval: ${PING_INTERVAL_MS / 1000}s`);
  console.log(`  Stale timeout: ${STALE_TIMEOUT_MS / 1000}s`);
  console.log("");

  // Connect to the internal SSE event source
  startEventSource(handleInternalEvent);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[shutdown] Stopping alert stream...");
  stopEventSource();

  for (const [ws] of clients) {
    ws.close(1001, "Server shutting down");
  }

  server.close(() => {
    console.log("[shutdown] Server closed");
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  console.log("\n[shutdown] SIGTERM received");
  stopEventSource();
  server.close(() => process.exit(0));
});
