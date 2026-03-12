/**
 * HyperQuote Telegram Alert Bot — Entry point.
 *
 * Starts:
 *  1. SQLite store (linked_users persistence)
 *  2. Alert-stream WebSocket connections (per-user subscription delivery)
 *  3. Public channel broadcaster (public RFQ firehose via SSE)
 *  4. grammY Telegram bot (long-polling command handling)
 *  5. HTTP health endpoint
 *
 * Run: npx tsx src/server.ts
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { initStore, closeStore } from "./store.js";
import { initConnections, closeAllConnections, getStreamStats } from "./alertStream.js";
import { startBot, stopBot } from "./bot.js";
import { flushAll, getDeliveryStats } from "./telegram.js";
import { startPublicChannel, stopPublicChannel, getPublicChannelStats } from "./publicChannel.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.TELEGRAM_BOT_PORT ?? "8095");

// ---------------------------------------------------------------------------
// HTTP health endpoint
// ---------------------------------------------------------------------------

function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === "/health") {
    const stream = getStreamStats();
    const delivery = getDeliveryStats();
    const publicChannel = getPublicChannelStats();

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        uptime: Math.floor(process.uptime()),
        connections: stream,
        delivery,
        publicChannel,
      })
    );
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found. Endpoints: /health" }));
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== HyperQuote Telegram Alert Bot ===");

  // 1. Initialize SQLite store
  initStore();

  // 2. Start alert-stream WebSocket connections (per-user subscription delivery)
  initConnections();

  // 3. Start public channel broadcaster (public RFQ firehose)
  startPublicChannel();

  // 4. Start Telegram bot (command handling)
  await startBot();

  // 5. Start HTTP health server
  const server = createServer(handleHttp);
  server.listen(PORT, () => {
    console.log(`[server] Health endpoint: http://127.0.0.1:${PORT}/health`);
    console.log("");
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("\n[shutdown] Stopping telegram bot...");

    // Flush pending messages
    flushAll();

    // Stop bot
    stopBot();

    // Stop public channel broadcaster
    stopPublicChannel();

    // Close WS connections
    closeAllConnections();

    // Close SQLite
    closeStore();

    // Close HTTP server
    server.close(() => {
      console.log("[shutdown] Server closed");
      process.exit(0);
    });

    // Force exit after 5s
    setTimeout(() => {
      console.log("[shutdown] Forced exit");
      process.exit(1);
    }, 5000);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[server] Fatal error:", err);
  process.exit(1);
});
