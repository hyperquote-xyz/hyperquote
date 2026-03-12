/**
 * HyperQuote RFQ Relay — WebSocket + REST server.
 *
 * Accepts RFQ submissions from users and Quote submissions from makers.
 * Verifies signatures on both, enforces V1 rails, and broadcasts to all clients.
 *
 * Run: npx tsx src/server.ts
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { WebSocketServer, WebSocket } from "ws";
import {
  verifyMessage,
  verifyTypedData,
  AbiCoder,
  keccak256,
  getAddress,
  TypedDataField,
} from "ethers";

// ---------------------------------------------------------------
// Types (subset — matches SDK types exactly)
// ---------------------------------------------------------------

interface RFQJson {
  requester: string;
  underlying: string;
  collateral: string;
  isCall: boolean;
  strike: string; // hex
  quantity: string; // hex
  expiry: string; // hex
  minPremium: string; // hex
  timestamp: string; // hex
}

interface QuoteJson {
  maker: string;
  taker: string;
  underlying: string;
  collateral: string;
  isCall: boolean;
  isMakerSeller: boolean;
  strike: string; // hex
  quantity: string; // hex
  premium: string; // hex
  expiry: string; // hex
  deadline: string; // hex
  nonce: string; // hex
}

interface StoredRFQ {
  rfqId: string;
  rfq: RFQJson;
  requester: string;
  createdAt: number;
  expiresAt: number; // relay TTL expiry (not option expiry)
}

interface StoredQuote {
  rfqId: string;
  quote: QuoteJson;
  makerSig: string;
  createdAt: number;
}

// ---------------------------------------------------------------
// Relay Message Protocol
// ---------------------------------------------------------------

type RelayMessageType =
  | "RFQ_SUBMIT"
  | "RFQ_BROADCAST"
  | "QUOTE_SUBMIT"
  | "QUOTE_BROADCAST"
  | "PING"
  | "PONG"
  | "ERROR";

interface RelayMessage {
  type: RelayMessageType;
  data: unknown;
}

// ---------------------------------------------------------------
// Config
// ---------------------------------------------------------------

const PORT = parseInt(process.env.RELAY_PORT ?? "8080");
const RFQ_TTL_SECS = parseInt(process.env.RFQ_TTL_SECS ?? "60");
const RATE_LIMIT_PER_MINUTE = parseInt(process.env.RATE_LIMIT_PER_MIN ?? "30");

/**
 * CORS allowed origins. Comma-separated list of origins (e.g. "https://app.hyperquote.io,https://staging.hyperquote.io").
 * Defaults to "*" in development; MUST be set explicitly in production.
 */
const CORS_ALLOWED_ORIGINS = process.env.CORS_ALLOWED_ORIGINS ?? "*";
const corsOriginSet = CORS_ALLOWED_ORIGINS === "*"
  ? null // allow all
  : new Set(CORS_ALLOWED_ORIGINS.split(",").map((o) => o.trim()));

function getCorsOrigin(reqOrigin?: string): string {
  if (!corsOriginSet) return "*";
  if (reqOrigin && corsOriginSet.has(reqOrigin)) return reqOrigin;
  return ""; // blocked
}

/**
 * EIP-712 config for quote signature verification.
 * Must match OptionsEngine's EIP712("HyperQuote Options", "1") domain.
 */
const CHAIN_ID = parseInt(process.env.CHAIN_ID ?? "31337");
const ENGINE_ADDRESS = process.env.ENGINE_ADDRESS ?? "0x5FbDB2315678afecb367f032d93F642f64180aa3";

// ---------------------------------------------------------------
// V1 Allowlists
// ---------------------------------------------------------------

/** V1: only WHYPE underlying */
const ALLOWED_UNDERLYING = new Set([
  (process.env.WHYPE_ADDRESS ?? "0x0000000000000000000000000000000000000001").toLowerCase(),
]);

/** V1: allowed collateral tokens */
const ALLOWED_COLLATERAL = new Set([
  (process.env.USDC_ADDRESS ?? "0x0000000000000000000000000000000000000002").toLowerCase(),
  (process.env.USDH_ADDRESS ?? "0x0000000000000000000000000000000000000003").toLowerCase(),
  (process.env.USDT0_ADDRESS ?? "0x0000000000000000000000000000000000000004").toLowerCase(),
]);

/** Expiry constraints */
const MIN_EXPIRY_SECS = 24 * 3600; // 24 hours minimum
const MAX_EXPIRY_SECS = 90 * 24 * 3600; // 90 days maximum

// ---------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------

const activeRfqs = new Map<string, StoredRFQ>();
const quotesByRfq = new Map<string, StoredQuote[]>();
const rateLimits = new Map<string, { count: number; windowStart: number }>();

// ---------------------------------------------------------------
// rfqId computation — MUST match sdk-maker/rfqHash.ts exactly
// ---------------------------------------------------------------

function computeRfqId(rfq: RFQJson): string {
  const coder = AbiCoder.defaultAbiCoder();
  const encoded = coder.encode(
    [
      "address",
      "address",
      "address",
      "bool",
      "uint256",
      "uint256",
      "uint256",
      "uint256",
      "uint256",
    ],
    [
      rfq.requester,
      rfq.underlying,
      rfq.collateral,
      rfq.isCall,
      BigInt(rfq.strike),
      BigInt(rfq.quantity),
      BigInt(rfq.expiry),
      BigInt(rfq.minPremium),
      BigInt(rfq.timestamp),
    ],
  );
  return keccak256(encoded);
}

// ---------------------------------------------------------------
// EIP-712 Quote types — MUST match sdk-maker/eip712.ts exactly
// ---------------------------------------------------------------

const QUOTE_TYPES: Record<string, TypedDataField[]> = {
  Quote: [
    { name: "maker", type: "address" },
    { name: "taker", type: "address" },
    { name: "underlying", type: "address" },
    { name: "collateral", type: "address" },
    { name: "isCall", type: "bool" },
    { name: "isMakerSeller", type: "bool" },
    { name: "strike", type: "uint256" },
    { name: "quantity", type: "uint256" },
    { name: "premium", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
};

function buildEip712Domain() {
  return {
    name: "HyperQuote Options",
    version: "1",
    chainId: CHAIN_ID,
    verifyingContract: ENGINE_ADDRESS,
  };
}

// ---------------------------------------------------------------
// Signature Verification
// ---------------------------------------------------------------

/**
 * Verify RFQ signature (EIP-191 personal_sign of the rfqId hash bytes).
 *
 * The user signs the raw 32-byte rfqId hash using personal_sign.
 * This is simpler than adding a separate EIP-712 type for RFQs (which
 * don't exist on-chain) and avoids polluting the on-chain domain.
 */
function verifyRfqSignature(rfqId: string, userSig: string, requester: string): boolean {
  try {
    // User signs the raw bytes of the rfqId hash
    const hashBytes = Buffer.from(rfqId.slice(2), "hex");
    const recovered = verifyMessage(hashBytes, userSig);
    return recovered.toLowerCase() === requester.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Verify Quote EIP-712 signature — must match sdk-maker verifyQuote.ts.
 *
 * Uses the same domain { name: "HyperQuote Options", version: "1", chainId, verifyingContract }
 * and the same Quote type as the on-chain OptionsEngine.
 */
function verifyQuoteSignature(quote: QuoteJson, makerSig: string): boolean {
  try {
    const domain = buildEip712Domain();
    const value = {
      maker: quote.maker,
      taker: quote.taker,
      underlying: quote.underlying,
      collateral: quote.collateral,
      isCall: quote.isCall,
      isMakerSeller: quote.isMakerSeller,
      strike: BigInt(quote.strike),
      quantity: BigInt(quote.quantity),
      premium: BigInt(quote.premium),
      expiry: BigInt(quote.expiry),
      deadline: BigInt(quote.deadline),
      nonce: BigInt(quote.nonce),
    };

    const recovered = verifyTypedData(domain, QUOTE_TYPES, value, makerSig);
    return recovered.toLowerCase() === quote.maker.toLowerCase();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------
// V1 RFQ Validation Rails
// ---------------------------------------------------------------

interface ValidationResult {
  valid: boolean;
  reason?: string;
}

function validateRfq(rfq: RFQJson): ValidationResult {
  const now = Math.floor(Date.now() / 1000);

  // 1. Underlying must be in allowlist (V1: WHYPE only)
  if (!ALLOWED_UNDERLYING.has(rfq.underlying.toLowerCase())) {
    return { valid: false, reason: `Underlying ${rfq.underlying} not allowed` };
  }

  // 2. Collateral must be in allowlist {USDH, USDC, USDT0}
  if (!ALLOWED_COLLATERAL.has(rfq.collateral.toLowerCase())) {
    return { valid: false, reason: `Collateral ${rfq.collateral} not allowed` };
  }

  // 3. Expiry must be snapped to 08:00 UTC (28800s into the day)
  const expiry = Number(BigInt(rfq.expiry));
  if (expiry % 86400 !== 28800) {
    return { valid: false, reason: `Expiry must be at 08:00 UTC (got offset ${expiry % 86400}s)` };
  }

  // 4. Expiry must be at least 24h from now
  const tenor = expiry - now;
  if (tenor < MIN_EXPIRY_SECS) {
    return { valid: false, reason: `Expiry too soon: ${tenor}s < ${MIN_EXPIRY_SECS}s minimum` };
  }

  // 5. Expiry must be at most 90d from now
  if (tenor > MAX_EXPIRY_SECS) {
    return { valid: false, reason: `Expiry too far: ${tenor}s > ${MAX_EXPIRY_SECS}s maximum` };
  }

  // 6. Quantity must be > 0
  if (BigInt(rfq.quantity) <= 0n) {
    return { valid: false, reason: "Quantity must be > 0" };
  }

  // 7. Strike must be > 0
  if (BigInt(rfq.strike) <= 0n) {
    return { valid: false, reason: "Strike must be > 0" };
  }

  // 8. Timestamp must be recent (within 60s of now — anti-replay)
  const rfqTimestamp = Number(BigInt(rfq.timestamp));
  const age = now - rfqTimestamp;
  if (age > 60 || age < -10) {
    return { valid: false, reason: `Timestamp out of range (age=${age}s)` };
  }

  return { valid: true };
}

// ---------------------------------------------------------------
// V1 Quote Validation Rails
// ---------------------------------------------------------------

function validateQuote(quote: QuoteJson, rfq: StoredRFQ): ValidationResult {
  const now = Math.floor(Date.now() / 1000);

  // 1. V1: isMakerSeller must be false
  if (quote.isMakerSeller !== false) {
    return { valid: false, reason: "V1: isMakerSeller must be false" };
  }

  // 2. Quote underlying/collateral/isCall must match RFQ
  if (quote.underlying.toLowerCase() !== rfq.rfq.underlying.toLowerCase()) {
    return { valid: false, reason: "Quote underlying doesn't match RFQ" };
  }
  if (quote.collateral.toLowerCase() !== rfq.rfq.collateral.toLowerCase()) {
    return { valid: false, reason: "Quote collateral doesn't match RFQ" };
  }
  if (quote.isCall !== rfq.rfq.isCall) {
    return { valid: false, reason: "Quote isCall doesn't match RFQ" };
  }

  // 3. Quote strike must match RFQ strike
  if (BigInt(quote.strike) !== BigInt(rfq.rfq.strike)) {
    return { valid: false, reason: "Quote strike doesn't match RFQ strike" };
  }

  // 4. Quote expiry must match RFQ expiry
  if (BigInt(quote.expiry) !== BigInt(rfq.rfq.expiry)) {
    return { valid: false, reason: "Quote expiry doesn't match RFQ expiry" };
  }

  // 5. Quote deadline must be in the future
  const deadline = Number(BigInt(quote.deadline));
  if (deadline <= now) {
    return { valid: false, reason: "Quote deadline is in the past" };
  }

  // 6. Premium must be > 0
  if (BigInt(quote.premium) <= 0n) {
    return { valid: false, reason: "Premium must be > 0" };
  }

  // 7. Quantity must be > 0
  if (BigInt(quote.quantity) <= 0n) {
    return { valid: false, reason: "Quantity must be > 0" };
  }

  return { valid: true };
}

// ---------------------------------------------------------------
// Rate Limiting
// ---------------------------------------------------------------

function checkRateLimit(ip: string): boolean {
  const now = Math.floor(Date.now() / 1000);
  const entry = rateLimits.get(ip);

  if (!entry || now - entry.windowStart >= 60) {
    rateLimits.set(ip, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= RATE_LIMIT_PER_MINUTE) {
    return false;
  }

  entry.count++;
  return true;
}

// ---------------------------------------------------------------
// Expiry Cleanup
// ---------------------------------------------------------------

function cleanupExpiredRfqs(): void {
  const now = Math.floor(Date.now() / 1000);
  for (const [id, rfq] of activeRfqs.entries()) {
    if (rfq.expiresAt <= now) {
      activeRfqs.delete(id);
      quotesByRfq.delete(id);
    }
  }
}

// Run cleanup every 10 seconds
setInterval(cleanupExpiredRfqs, 10_000);

// ---------------------------------------------------------------
// WebSocket Server
// ---------------------------------------------------------------

const server = createServer(handleHttpRequest);
const wss = new WebSocketServer({ server });
const clients = new Set<WebSocket>();

wss.on("connection", (ws, req) => {
  const ip = req.socket.remoteAddress ?? "unknown";
  console.log(`[WS] Client connected from ${ip} (total: ${clients.size + 1})`);
  clients.add(ws);

  ws.on("message", (data) => {
    try {
      // Rate limit check
      if (!checkRateLimit(ip)) {
        sendError(ws, "Rate limit exceeded (max " + RATE_LIMIT_PER_MINUTE + " msg/min)");
        return;
      }

      const msg = JSON.parse(data.toString()) as RelayMessage;
      handleWsMessage(ws, msg, ip);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      sendError(ws, `Parse error: ${message}`);
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[WS] Client disconnected from ${ip} (total: ${clients.size})`);
  });

  ws.on("error", (err) => {
    console.error(`[WS ERROR] ${ip}:`, err.message);
    clients.delete(ws);
  });
});

// ---------------------------------------------------------------
// WS Message Handler
// ---------------------------------------------------------------

function sendError(ws: WebSocket, message: string): void {
  ws.send(JSON.stringify({ type: "ERROR", data: { message } }));
}

function broadcast(msg: object, exclude?: WebSocket): void {
  const payload = JSON.stringify(msg);
  for (const client of clients) {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function handleWsMessage(ws: WebSocket, msg: RelayMessage, ip: string): void {
  switch (msg.type) {
    case "RFQ_SUBMIT":
      handleRfqSubmit(ws, msg.data as { rfq: RFQJson; userSig: string }, ip);
      break;

    case "QUOTE_SUBMIT":
      handleQuoteSubmit(
        ws,
        msg.data as { rfqId: string; quote: QuoteJson; makerSig: string },
        ip,
      );
      break;

    case "PING":
      ws.send(JSON.stringify({ type: "PONG", data: {} }));
      break;

    case "PONG":
      break; // keepalive ack

    default:
      sendError(ws, `Unknown message type: ${msg.type}`);
  }
}

// ---------------------------------------------------------------
// RFQ Submit Handler
// ---------------------------------------------------------------

function handleRfqSubmit(
  ws: WebSocket,
  data: { rfq: RFQJson; userSig: string },
  ip: string,
): void {
  const { rfq, userSig } = data;

  // Validate required fields
  if (!rfq || !userSig) {
    sendError(ws, "Missing rfq or userSig");
    return;
  }

  // Normalize requester address (checksum)
  try {
    rfq.requester = getAddress(rfq.requester);
  } catch {
    sendError(ws, "Invalid requester address");
    return;
  }

  // Normalize underlying / collateral
  try {
    rfq.underlying = getAddress(rfq.underlying);
    rfq.collateral = getAddress(rfq.collateral);
  } catch {
    sendError(ws, "Invalid underlying or collateral address");
    return;
  }

  // Compute rfqId (deterministic, matches SDK)
  const rfqId = computeRfqId(rfq);

  // Check for duplicate
  if (activeRfqs.has(rfqId)) {
    sendError(ws, "Duplicate RFQ");
    return;
  }

  // V1 validation rails
  const validation = validateRfq(rfq);
  if (!validation.valid) {
    sendError(ws, `RFQ rejected: ${validation.reason}`);
    return;
  }

  // Verify user signature (EIP-191 of rfqId hash bytes)
  if (!verifyRfqSignature(rfqId, userSig, rfq.requester)) {
    sendError(ws, "Invalid RFQ signature — signer does not match requester");
    return;
  }

  // Store
  const now = Math.floor(Date.now() / 1000);
  activeRfqs.set(rfqId, {
    rfqId,
    rfq,
    requester: rfq.requester,
    createdAt: now,
    expiresAt: now + RFQ_TTL_SECS,
  });
  quotesByRfq.set(rfqId, []);

  console.log(
    `[RFQ] ${rfqId.slice(0, 14)}... from ${rfq.requester.slice(0, 10)}...` +
      ` ${rfq.isCall ? "CC" : "CSP"} K=${rfq.strike} Q=${rfq.quantity} (${ip})`,
  );

  // Broadcast to ALL clients (including submitter, so they get the rfqId)
  const broadcastMsg = {
    type: "RFQ_BROADCAST",
    data: { rfqId, rfq },
  };
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(broadcastMsg));
    }
  }
}

// ---------------------------------------------------------------
// Quote Submit Handler
// ---------------------------------------------------------------

function handleQuoteSubmit(
  ws: WebSocket,
  data: { rfqId: string; quote: QuoteJson; makerSig: string },
  ip: string,
): void {
  const { rfqId, quote, makerSig } = data;

  // Validate required fields
  if (!rfqId || !quote || !makerSig) {
    sendError(ws, "Missing rfqId, quote, or makerSig");
    return;
  }

  // Check RFQ exists and is active
  const storedRfq = activeRfqs.get(rfqId);
  if (!storedRfq) {
    sendError(ws, "RFQ not found or expired");
    return;
  }

  // Normalize maker address
  try {
    quote.maker = getAddress(quote.maker);
  } catch {
    sendError(ws, "Invalid maker address");
    return;
  }

  // Quote validation rails
  const validation = validateQuote(quote, storedRfq);
  if (!validation.valid) {
    sendError(ws, `Quote rejected: ${validation.reason}`);
    return;
  }

  // *** CRITICAL: Verify EIP-712 maker signature ***
  if (!verifyQuoteSignature(quote, makerSig)) {
    sendError(ws, "Invalid Quote EIP-712 signature — signer does not match maker");
    return;
  }

  // Check for duplicate maker on this RFQ
  const existingQuotes = quotesByRfq.get(rfqId) ?? [];
  const alreadyQuoted = existingQuotes.some(
    (q) => q.quote.maker.toLowerCase() === quote.maker.toLowerCase(),
  );
  if (alreadyQuoted) {
    sendError(ws, "Duplicate quote from this maker for this RFQ");
    return;
  }

  // Store
  const stored: StoredQuote = {
    rfqId,
    quote,
    makerSig,
    createdAt: Math.floor(Date.now() / 1000),
  };
  existingQuotes.push(stored);
  quotesByRfq.set(rfqId, existingQuotes);

  const premiumDisplay = BigInt(quote.premium).toString();
  console.log(
    `[QUOTE] for ${rfqId.slice(0, 14)}... from ${quote.maker.slice(0, 10)}...` +
      ` premium=${premiumDisplay} (${ip})`,
  );

  // Broadcast to ALL clients (including RFQ submitter who listens for quotes)
  const broadcastMsg = {
    type: "QUOTE_BROADCAST",
    data: { rfqId, quote, makerSig },
  };
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(broadcastMsg));
    }
  }
}

// ---------------------------------------------------------------
// HTTP REST Endpoints
// ---------------------------------------------------------------

function handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  // CORS headers — restrict to allowed origins in production
  const origin = getCorsOrigin(req.headers.origin as string | undefined);
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (origin !== "*") res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  if (url.pathname === "/rfqs") {
    // GET /rfqs — return active, unexpired RFQs
    cleanupExpiredRfqs();
    const rfqs = Array.from(activeRfqs.values()).map((r) => ({
      rfqId: r.rfqId,
      rfq: r.rfq,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      quoteCount: (quotesByRfq.get(r.rfqId) ?? []).length,
    }));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ count: rfqs.length, rfqs }));
    return;
  }

  if (url.pathname === "/quotes") {
    // GET /quotes?rfqId=...
    const rfqId = url.searchParams.get("rfqId");
    if (!rfqId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing rfqId query parameter" }));
      return;
    }

    const quotes = (quotesByRfq.get(rfqId) ?? []).map((q) => ({
      quote: q.quote,
      makerSig: q.makerSig,
      createdAt: q.createdAt,
    }));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ rfqId, count: quotes.length, quotes }));
    return;
  }

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        chainId: CHAIN_ID,
        engineAddress: ENGINE_ADDRESS,
        activeRfqs: activeRfqs.size,
        totalQuotes: Array.from(quotesByRfq.values()).reduce((s, q) => s + q.length, 0),
        connectedClients: clients.size,
        uptime: Math.floor(process.uptime()),
      }),
    );
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found. Endpoints: /rfqs, /quotes?rfqId=, /health" }));
}

// ---------------------------------------------------------------
// Start
// ---------------------------------------------------------------

server.listen(PORT, () => {
  console.log("=== HyperQuote RFQ Relay ===");
  console.log(`  WebSocket:  ws://127.0.0.1:${PORT}`);
  console.log(`  REST:       http://127.0.0.1:${PORT}`);
  console.log(`  Chain ID:   ${CHAIN_ID}`);
  console.log(`  Engine:     ${ENGINE_ADDRESS}`);
  console.log(`  RFQ TTL:    ${RFQ_TTL_SECS}s`);
  console.log(`  Rate limit: ${RATE_LIMIT_PER_MINUTE} msg/min per IP`);
  console.log(`  Underlying: ${[...ALLOWED_UNDERLYING].join(", ")}`);
  console.log(`  Collateral: ${[...ALLOWED_COLLATERAL].join(", ")}`);
  console.log("");
});
