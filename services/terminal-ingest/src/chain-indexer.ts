/**
 * Chain Indexer — HyperEVM on-chain event subscription
 *
 * Subscribes to OptionsEngine + SettlementPublisher events via WebSocket:
 *   - QuoteExecuted(bytes32 indexed quoteHash, uint256 indexed positionId, address indexed maker, address taker)
 *   - KeeperFeePaid(uint256 indexed positionId, address indexed keeper, uint256 fee)
 *   - PositionSettled(uint256 indexed positionId, address indexed settler, uint256 settlementPrice, uint256 underlyingTransferred, uint256 collateralTransferred)
 *   - PositionExpired(uint256 indexed positionId, uint256 collateralReturned, address indexed returnedTo)
 *   - SettlementPricePublished(address indexed asset, uint256 indexed expiry, uint256 price, address publisher)
 *
 * On QuoteExecuted:
 *   1. Reads the Position struct from OptionsEngine.getPosition(positionId)
 *   2. Fetches spot from hl_spot for the underlying
 *   3. Computes Black-Scholes IV from premium, spot, strike, T
 *   4. Inserts into hq_executions (full) AND unified_tape (normalized)
 *
 * Uses viem for ABI decoding and WebSocket transport.
 * Falls back to HTTP polling if WebSocket is unavailable.
 */

import {
  createPublicClient,
  webSocket,
  http,
  parseAbiItem,
  decodeEventLog,
  type PublicClient,
  type Log,
  type WatchEventReturnType,
  type Address,
} from "viem";
import { query } from "./db.js";
import { solveIV } from "./bs-iv.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RPC_WS_URL = process.env.HYPER_EVM_WS_URL || "wss://api.hyperliquid.xyz/evm/ws";
const RPC_HTTP_URL = process.env.HYPER_EVM_RPC_URL || "https://api.hyperliquid.xyz/evm";
const OPTIONS_ENGINE_ADDRESS = process.env.OPTIONS_ENGINE_ADDRESS as Address | undefined;
const SETTLEMENT_PUBLISHER_ADDRESS = process.env.SETTLEMENT_PUBLISHER_ADDRESS as Address | undefined;
const POLL_INTERVAL_MS = Number(process.env.CHAIN_POLL_INTERVAL_MS || "5000");
const RISK_FREE_RATE = Number(process.env.RISK_FREE_RATE || "0.05");

// ---------------------------------------------------------------------------
// ABI event signatures
// ---------------------------------------------------------------------------

const QUOTE_EXECUTED = parseAbiItem(
  "event QuoteExecuted(bytes32 indexed quoteHash, uint256 indexed positionId, address indexed maker, address taker)",
);
const KEEPER_FEE_PAID = parseAbiItem(
  "event KeeperFeePaid(uint256 indexed positionId, address indexed keeper, uint256 fee)",
);
const POSITION_SETTLED = parseAbiItem(
  "event PositionSettled(uint256 indexed positionId, address indexed settler, uint256 settlementPrice, uint256 underlyingTransferred, uint256 collateralTransferred)",
);
const POSITION_EXPIRED = parseAbiItem(
  "event PositionExpired(uint256 indexed positionId, uint256 collateralReturned, address indexed returnedTo)",
);
const SETTLEMENT_PRICE_PUBLISHED = parseAbiItem(
  "event SettlementPricePublished(address indexed asset, uint256 indexed expiry, uint256 price, address publisher)",
);

// Combined ABI for decoding
const OPTIONS_ENGINE_ABI = [
  QUOTE_EXECUTED,
  KEEPER_FEE_PAID,
  POSITION_SETTLED,
  POSITION_EXPIRED,
] as const;

const SETTLEMENT_ABI = [SETTLEMENT_PRICE_PUBLISHED] as const;

// ---------------------------------------------------------------------------
// getPosition ABI — for reading the full Position struct after execution
// ---------------------------------------------------------------------------
// Position struct: { seller, buyer, underlying, collateral, isCall,
//                    strike, quantity, premium, expiry, collateralLocked, state }

const GET_POSITION_ABI = [
  {
    name: "getPosition",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "positionId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "seller", type: "address" },
          { name: "buyer", type: "address" },
          { name: "underlying", type: "address" },
          { name: "collateral", type: "address" },
          { name: "isCall", type: "bool" },
          { name: "strike", type: "uint256" },
          { name: "quantity", type: "uint256" },
          { name: "premium", type: "uint256" },
          { name: "expiry", type: "uint256" },
          { name: "collateralLocked", type: "uint256" },
          { name: "state", type: "uint8" },
        ],
      },
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// Underlying address → symbol mapping (configurable via env)
// ---------------------------------------------------------------------------
// Format: "0xAddr1=HYPE,0xAddr2=ETH,0xAddr3=BTC"
// Falls back to empty map — if not set, underlying is stored as the raw address.

const UNDERLYING_SYMBOLS: Map<string, string> = new Map();
const COLLATERAL_DECIMALS: Map<string, number> = new Map();

if (process.env.UNDERLYING_SYMBOL_MAP) {
  for (const entry of process.env.UNDERLYING_SYMBOL_MAP.split(",")) {
    const [addr, symbol] = entry.split("=");
    if (addr && symbol) UNDERLYING_SYMBOLS.set(addr.toLowerCase().trim(), symbol.trim());
  }
}

// Format: "0xAddr1=6,0xAddr2=18"
if (process.env.COLLATERAL_DECIMALS_MAP) {
  for (const entry of process.env.COLLATERAL_DECIMALS_MAP.split(",")) {
    const [addr, dec] = entry.split("=");
    if (addr && dec) COLLATERAL_DECIMALS.set(addr.toLowerCase().trim(), Number(dec.trim()));
  }
}

function resolveUnderlyingSymbol(addr: string): string {
  return UNDERLYING_SYMBOLS.get(addr.toLowerCase()) ?? addr;
}

function resolveCollateralDecimals(addr: string): number {
  return COLLATERAL_DECIMALS.get(addr.toLowerCase()) ?? 6; // default USDC = 6
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bigintToNumericStr(value: bigint): string {
  return value.toString();
}

function wei18ToDisplay(value: bigint): number {
  return Number(value) / 1e18;
}

function blockTimestamp(block: { timestamp: bigint }): Date {
  return new Date(Number(block.timestamp) * 1000);
}

/**
 * Fetch the spot price for a symbol as-of a specific block timestamp.
 *
 * Uses the most recent hl_spot row sampled at or before the given time.
 * Falls back to the absolute latest row if no as-of row exists (cold start).
 * Returns null only if hl_spot has zero rows for this asset.
 */
async function getSpotFromDb(symbol: string, asOf: Date): Promise<number | null> {
  // 1. As-of lookup: most recent sample <= block timestamp
  const asOfResult = await query(
    `SELECT price FROM hl_spot
     WHERE asset = $1
       AND sampled_at <= $2
     ORDER BY sampled_at DESC
     LIMIT 1`,
    [symbol, asOf],
  );
  if (asOfResult.rows.length > 0) {
    return asOfResult.rows[0].price as number;
  }

  // 2. Fallback: absolute latest (covers cold-start where all samples
  //    post-date the block being backfilled)
  const latestResult = await query(
    `SELECT price FROM hl_spot
     WHERE asset = $1
     ORDER BY sampled_at DESC
     LIMIT 1`,
    [symbol],
  );
  if (latestResult.rows.length > 0) {
    console.log(
      `[chain] spot fallback: using latest spot for ${symbol} at ${asOf.toISOString()}`,
    );
    return latestResult.rows[0].price as number;
  }

  // 3. No spot data at all for this asset
  console.warn(
    `[chain] WARNING: no spot available for ${symbol} at ${asOf.toISOString()}`,
  );
  return null;
}

/**
 * Build a Derive-style instrument name for HyperQuote positions.
 * e.g. "HYPE-20260301-25-C"
 */
function buildInstrumentName(
  symbol: string,
  expiryTs: Date,
  strikeDisplay: number,
  isCall: boolean,
): string {
  const y = expiryTs.getUTCFullYear();
  const m = String(expiryTs.getUTCMonth() + 1).padStart(2, "0");
  const d = String(expiryTs.getUTCDate()).padStart(2, "0");
  const side = isCall ? "C" : "P";
  return `${symbol}-${y}${m}${d}-${strikeDisplay}-${side}`;
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleQuoteExecuted(
  log: Log,
  client: PublicClient,
): Promise<void> {
  const decoded = decodeEventLog({
    abi: [QUOTE_EXECUTED],
    data: log.data,
    topics: log.topics,
  });

  const { quoteHash, positionId, maker } = decoded.args;
  const taker = (decoded.args as { taker: Address }).taker;

  const block = await client.getBlock({ blockNumber: log.blockNumber! });
  const blockTs = blockTimestamp(block);

  // ── 1. Read Position struct from contract ──
  interface PositionStruct {
    seller: Address;
    buyer: Address;
    underlying: Address;
    collateral: Address;
    isCall: boolean;
    strike: bigint;
    quantity: bigint;
    premium: bigint;
    expiry: bigint;
    collateralLocked: bigint;
    state: number;
  }

  let positionData: PositionStruct | null = null;

  try {
    const posResult = await client.readContract({
      address: OPTIONS_ENGINE_ADDRESS!,
      abi: GET_POSITION_ABI,
      functionName: "getPosition",
      args: [positionId],
    });
    positionData = posResult as unknown as PositionStruct;
  } catch (err) {
    console.warn(
      `[chain] Failed to read Position ${positionId}: ${(err as Error).message}`,
    );
  }

  // ── 2. Resolve underlying symbol, compute display values ──
  const underlyingAddr = positionData?.underlying ?? null;
  const collateralAddr = positionData?.collateral ?? null;
  const underlyingSymbol = underlyingAddr
    ? resolveUnderlyingSymbol(underlyingAddr)
    : null;
  const cDec = collateralAddr
    ? resolveCollateralDecimals(collateralAddr)
    : 6;
  const isCall = positionData?.isCall ?? null;
  const strike1e18 = positionData
    ? bigintToNumericStr(positionData.strike)
    : null;
  const strikeDisplay = positionData
    ? wei18ToDisplay(positionData.strike)
    : null;
  const quantity1e18 = positionData
    ? bigintToNumericStr(positionData.quantity)
    : null;
  // quantity display: underlying is typically 18 decimals
  const quantityDisplay = positionData
    ? Number(positionData.quantity) / 1e18
    : null;
  const premiumRaw = positionData
    ? bigintToNumericStr(positionData.premium)
    : null;
  const premiumDisplay = positionData
    ? Number(positionData.premium) / 10 ** cDec
    : null;
  // Premium USD = premium / 10^cDec (collateral is stablecoin ≈ $1)
  const premiumUsd = premiumDisplay;
  const expiryTs = positionData
    ? new Date(Number(positionData.expiry) * 1000)
    : null;
  const collateralLocked = positionData
    ? bigintToNumericStr(positionData.collateralLocked)
    : null;

  // Per-contract price: premium_usd / quantity_display
  const pricePerContract =
    premiumUsd != null && quantityDisplay != null && quantityDisplay > 0
      ? premiumUsd / quantityDisplay
      : null;

  // ── 3. Build instrument name ──
  const instrument =
    underlyingSymbol && expiryTs && strikeDisplay != null && isCall != null
      ? buildInstrumentName(underlyingSymbol, expiryTs, strikeDisplay, isCall)
      : `HQ-${positionId}`;

  // ── 4. Fetch spot from hl_spot and compute IV ──
  let spot: number | null = null;
  let iv: number | null = null;

  if (underlyingSymbol && strikeDisplay && expiryTs && pricePerContract != null && isCall != null) {
    spot = await getSpotFromDb(underlyingSymbol, blockTs);

    if (spot == null) {
      console.warn(
        `[chain] IV skipped: no spot for ${instrument} at block ${log.blockNumber}`,
      );
    } else if (spot > 0) {
      const T =
        (expiryTs.getTime() - blockTs.getTime()) / (365.25 * 24 * 3600 * 1000);

      if (T > 0) {
        iv = solveIV(spot, strikeDisplay, T, pricePerContract, isCall, RISK_FREE_RATE);

        if (iv != null) {
          console.log(
            `[chain] IV solved: pos=${positionId} spot=${spot.toFixed(2)} ` +
            `K=${strikeDisplay} T=${(T * 365.25).toFixed(1)}d ` +
            `price=${pricePerContract.toFixed(4)} iv=${(iv * 100).toFixed(1)}%`,
          );
        } else {
          console.warn(
            `[chain] IV solve failed for ${instrument} ` +
            `premium=${pricePerContract.toFixed(4)} spot=${spot.toFixed(2)} ` +
            `strike=${strikeDisplay} T=${(T * 365.25).toFixed(1)}d`,
          );
        }
      }
    }
  }

  // ── 5. Insert into hq_executions (full) ──
  const res = await query(
    `INSERT INTO hq_executions (
      tx_hash, log_index, block_number, block_timestamp,
      quote_hash, position_id, maker, taker,
      underlying, collateral, is_call,
      strike, strike_display, quantity, quantity_display,
      premium, premium_display, premium_usd, collateral_decimals,
      expiry, collateral_locked
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7, $8,
      $9, $10, $11,
      $12, $13, $14, $15,
      $16, $17, $18, $19,
      $20, $21
    ) ON CONFLICT (tx_hash, log_index) DO NOTHING`,
    [
      log.transactionHash,
      log.logIndex,
      Number(log.blockNumber),
      blockTs,
      quoteHash,
      Number(positionId),
      maker,
      taker,
      underlyingAddr,
      collateralAddr,
      isCall,
      strike1e18,
      strikeDisplay,
      quantity1e18,
      quantityDisplay,
      premiumRaw,
      premiumDisplay,
      premiumUsd,
      cDec,
      expiryTs,
      collateralLocked,
    ],
  );

  // ── 6. Insert into unified_tape (normalized) ──
  if (res.rowCount && res.rowCount > 0) {
    await query(
      `INSERT INTO unified_tape (
        venue, trade_ref, instrument, underlying, is_call,
        strike, strike_display, expiry,
        price, quantity_display, quantity_raw, premium_usd,
        iv, spot_ref, side, counterparty,
        derive_liquidity_guess, ts
      ) VALUES (
        'HYPERQUOTE', $1, $2, $3, $4,
        $5, $6, $7,
        $8, $9, $10, $11,
        $12, $13, $14, $15,
        'RFQ', $16
      ) ON CONFLICT (venue, trade_ref) DO NOTHING`,
      [
        quoteHash,                               // trade_ref
        instrument,                              // instrument
        underlyingSymbol ?? underlyingAddr,       // underlying
        isCall ?? false,                         // is_call
        strike1e18 ?? "0",                       // strike (1e18)
        strikeDisplay ?? 0,                      // strike_display
        expiryTs,                                // expiry
        pricePerContract ?? 0,                   // price (per-contract)
        quantityDisplay,                         // quantity_display
        quantity1e18,                            // quantity_raw
        premiumUsd,                              // premium_usd
        iv,                                      // iv (Black-Scholes solved)
        spot,                                    // spot_ref
        "trade",                                 // side
        maker,                                   // counterparty (buyer)
        blockTs,                                 // ts
      ],
    );

    console.log(
      `[chain] QuoteExecuted → tape: pos=${positionId} ${instrument} ` +
      `premium=$${premiumUsd?.toFixed(2) ?? "?"} iv=${iv != null ? (iv * 100).toFixed(1) + "%" : "?"} ` +
      `block=${log.blockNumber}`,
    );
  }
}

async function handleKeeperFeePaid(log: Log, client: PublicClient): Promise<void> {
  const decoded = decodeEventLog({
    abi: [KEEPER_FEE_PAID],
    data: log.data,
    topics: log.topics,
  });

  const { positionId, keeper, fee } = decoded.args;

  // Update the execution row to add keeper info
  const res = await query(
    `UPDATE hq_executions
     SET keeper_fee = $1, keeper_address = $2
     WHERE position_id = $3 AND keeper_fee IS NULL`,
    [bigintToNumericStr(fee), keeper, Number(positionId)],
  );

  if (res.rowCount && res.rowCount > 0) {
    console.log(
      `[chain] KeeperFeePaid: pos=${positionId} keeper=${keeper.slice(0, 10)}... fee=${fee}`,
    );
  }
}

async function handlePositionSettled(log: Log, client: PublicClient): Promise<void> {
  const decoded = decodeEventLog({
    abi: [POSITION_SETTLED],
    data: log.data,
    topics: log.topics,
  });

  const { positionId, settler, settlementPrice, underlyingTransferred, collateralTransferred } =
    decoded.args;

  const block = await client.getBlock({ blockNumber: log.blockNumber! });
  const blockTs = blockTimestamp(block);

  const res = await query(
    `INSERT INTO hq_settlements (
      tx_hash, log_index, block_number, block_timestamp,
      event_type, position_id, settler,
      settlement_price, settlement_price_display,
      underlying_transferred, collateral_transferred
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (tx_hash, log_index) DO NOTHING`,
    [
      log.transactionHash,
      log.logIndex,
      Number(log.blockNumber),
      blockTs,
      "settled",
      Number(positionId),
      settler,
      bigintToNumericStr(settlementPrice),
      wei18ToDisplay(settlementPrice),
      bigintToNumericStr(underlyingTransferred),
      bigintToNumericStr(collateralTransferred),
    ],
  );

  if (res.rowCount && res.rowCount > 0) {
    console.log(
      `[chain] PositionSettled: pos=${positionId} price=${wei18ToDisplay(settlementPrice)} ` +
      `block=${log.blockNumber}`,
    );
  }
}

async function handlePositionExpired(log: Log, client: PublicClient): Promise<void> {
  const decoded = decodeEventLog({
    abi: [POSITION_EXPIRED],
    data: log.data,
    topics: log.topics,
  });

  const { positionId, collateralReturned, returnedTo } = decoded.args;

  const block = await client.getBlock({ blockNumber: log.blockNumber! });
  const blockTs = blockTimestamp(block);

  const res = await query(
    `INSERT INTO hq_settlements (
      tx_hash, log_index, block_number, block_timestamp,
      event_type, position_id,
      collateral_returned, returned_to
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (tx_hash, log_index) DO NOTHING`,
    [
      log.transactionHash,
      log.logIndex,
      Number(log.blockNumber),
      blockTs,
      "expired",
      Number(positionId),
      bigintToNumericStr(collateralReturned),
      returnedTo,
    ],
  );

  if (res.rowCount && res.rowCount > 0) {
    console.log(
      `[chain] PositionExpired: pos=${positionId} returned=${collateralReturned} ` +
      `to=${returnedTo.slice(0, 10)}...`,
    );
  }
}

async function handleSettlementPricePublished(log: Log, client: PublicClient): Promise<void> {
  const decoded = decodeEventLog({
    abi: [SETTLEMENT_PRICE_PUBLISHED],
    data: log.data,
    topics: log.topics,
  });

  const { asset, expiry, price, publisher } = decoded.args;

  const block = await client.getBlock({ blockNumber: log.blockNumber! });
  const blockTs = blockTimestamp(block);
  const publishedExpiry = new Date(Number(expiry) * 1000);

  const res = await query(
    `INSERT INTO hq_settlements (
      tx_hash, log_index, block_number, block_timestamp,
      event_type, asset, published_expiry, publisher,
      settlement_price, settlement_price_display
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (tx_hash, log_index) DO NOTHING`,
    [
      log.transactionHash,
      log.logIndex,
      Number(log.blockNumber),
      blockTs,
      "price_published",
      asset,
      publishedExpiry,
      publisher,
      bigintToNumericStr(price),
      wei18ToDisplay(price),
    ],
  );

  if (res.rowCount && res.rowCount > 0) {
    console.log(
      `[chain] SettlementPricePublished: asset=${asset.slice(0, 10)}... ` +
      `expiry=${publishedExpiry.toISOString()} price=${wei18ToDisplay(price)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Log router — dispatches decoded logs to the correct handler
// ---------------------------------------------------------------------------

async function routeLog(log: Log, client: PublicClient): Promise<void> {
  const topic0 = log.topics[0];
  if (!topic0) return;

  try {
    // Try decoding against OptionsEngine events first
    if (log.address?.toLowerCase() === OPTIONS_ENGINE_ADDRESS?.toLowerCase()) {
      try {
        const decoded = decodeEventLog({
          abi: OPTIONS_ENGINE_ABI,
          data: log.data,
          topics: log.topics,
        });
        switch (decoded.eventName) {
          case "QuoteExecuted":
            await handleQuoteExecuted(log, client);
            break;
          case "KeeperFeePaid":
            await handleKeeperFeePaid(log, client);
            break;
          case "PositionSettled":
            await handlePositionSettled(log, client);
            break;
          case "PositionExpired":
            await handlePositionExpired(log, client);
            break;
        }
        return;
      } catch {
        // Not an OptionsEngine event we recognize
      }
    }

    // Try SettlementPublisher events
    if (log.address?.toLowerCase() === SETTLEMENT_PUBLISHER_ADDRESS?.toLowerCase()) {
      try {
        const decoded = decodeEventLog({
          abi: SETTLEMENT_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "SettlementPricePublished") {
          await handleSettlementPricePublished(log, client);
        }
      } catch {
        // Not a settlement event we recognize
      }
    }
  } catch (err) {
    console.error("[chain] Error routing log:", (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// WebSocket subscription
// ---------------------------------------------------------------------------

let client: PublicClient | null = null;
let engineUnsub: WatchEventReturnType | null = null;
let settlementUnsub: WatchEventReturnType | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastProcessedBlock = 0n;

export function startChainIndexer(): void {
  if (!OPTIONS_ENGINE_ADDRESS) {
    console.warn("[chain] OPTIONS_ENGINE_ADDRESS not set — chain indexer disabled");
    return;
  }

  // Try WebSocket first, fall back to HTTP polling
  try {
    client = createPublicClient({
      transport: webSocket(RPC_WS_URL),
    }) as PublicClient;
    console.log(`[chain] Connected via WebSocket: ${RPC_WS_URL}`);
    startWsSubscriptions();
  } catch {
    console.log("[chain] WebSocket unavailable, falling back to HTTP polling");
    client = createPublicClient({
      transport: http(RPC_HTTP_URL),
    }) as PublicClient;
    startHttpPolling();
  }
}

function startWsSubscriptions(): void {
  if (!client || !OPTIONS_ENGINE_ADDRESS) return;

  console.log(`[chain] Watching OptionsEngine at ${OPTIONS_ENGINE_ADDRESS}`);

  engineUnsub = client.watchEvent({
    address: OPTIONS_ENGINE_ADDRESS,
    onLogs: (logs) => {
      for (const log of logs) {
        void routeLog(log, client!);
      }
    },
    onError: (err) => {
      console.error("[chain] WS event error (engine):", err.message);
      // Reconnect on error
      setTimeout(() => {
        console.log("[chain] Reconnecting WS...");
        stopChainIndexer();
        startChainIndexer();
      }, 5000);
    },
  });

  if (SETTLEMENT_PUBLISHER_ADDRESS) {
    console.log(`[chain] Watching SettlementPublisher at ${SETTLEMENT_PUBLISHER_ADDRESS}`);
    settlementUnsub = client.watchEvent({
      address: SETTLEMENT_PUBLISHER_ADDRESS,
      onLogs: (logs) => {
        for (const log of logs) {
          void routeLog(log, client!);
        }
      },
      onError: (err) => {
        console.error("[chain] WS event error (settlement):", err.message);
      },
    });
  }
}

async function pollLogs(): Promise<void> {
  if (!client || !OPTIONS_ENGINE_ADDRESS) return;

  try {
    const currentBlock = await client.getBlockNumber();
    if (lastProcessedBlock === 0n) {
      // Start from recent blocks on first run
      lastProcessedBlock = currentBlock - 100n;
    }

    if (currentBlock <= lastProcessedBlock) return;

    // Fetch logs from OptionsEngine
    const engineLogs = await client.getLogs({
      address: OPTIONS_ENGINE_ADDRESS,
      fromBlock: lastProcessedBlock + 1n,
      toBlock: currentBlock,
    });

    for (const log of engineLogs) {
      await routeLog(log, client);
    }

    // Fetch logs from SettlementPublisher
    if (SETTLEMENT_PUBLISHER_ADDRESS) {
      const settlementLogs = await client.getLogs({
        address: SETTLEMENT_PUBLISHER_ADDRESS as Address,
        fromBlock: lastProcessedBlock + 1n,
        toBlock: currentBlock,
      });

      for (const log of settlementLogs) {
        await routeLog(log, client);
      }
    }

    lastProcessedBlock = currentBlock;
  } catch (err) {
    console.error("[chain] Poll error:", (err as Error).message);
  }
}

function startHttpPolling(): void {
  console.log(`[chain] HTTP polling every ${POLL_INTERVAL_MS}ms`);
  void pollLogs();
  pollTimer = setInterval(() => void pollLogs(), POLL_INTERVAL_MS);
}

export function stopChainIndexer(): void {
  if (engineUnsub) {
    engineUnsub();
    engineUnsub = null;
  }
  if (settlementUnsub) {
    settlementUnsub();
    settlementUnsub = null;
  }
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  client = null;
  console.log("[chain] Indexer stopped.");
}
