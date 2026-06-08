/**
 * Maker Bot — connects to the RFQ relay via WebSocket.
 *
 * Pipeline: Connect → Listen for RFQ_BROADCAST → Filter → Price → Risk → Sign → QUOTE_SUBMIT
 *
 * Run: npx tsx src/makerRelay.ts
 * Requires relay running at ws://127.0.0.1:8080 (or set RELAY_WS_URL)
 */

import { Wallet } from "ethers";
import WebSocket from "ws";

import {
  Quote,
  MakerConfig,
  RFQ,
  RFQBroadcastMessage,
  QuoteSubmitMessage,
  RelayMessage,
  quoteToJson,
  rfqFromJson,
} from "./types.js";
import { signQuote } from "./signQuote.js";
import { StubPricingEngine, MarketData } from "./pricing.js";
import { RiskState, checkRisk, computeNotional } from "./risk.js";

// ---------------------------------------------------------------
// Config
// ---------------------------------------------------------------

// Well-known Hardhat/Anvil account #1 key — LOCAL TEST ONLY, never funded on any live chain.
const ANVIL_DEV_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

/**
 * Resolve the maker signing key.
 *
 * - If MAKER_PRIVATE_KEY is set, always use it.
 * - Otherwise, the Anvil dev key is permitted ONLY when running against the
 *   local Anvil chain (chainId 31337) AND not in production. A loud warning is
 *   printed. In every other case startup HARD-FAILS — we never silently sign
 *   with a well-known key on a live network.
 */
function resolveMakerPrivateKey(chainId: number): string {
  const pk = process.env.MAKER_PRIVATE_KEY;
  if (pk && pk.length > 0) return pk;

  const isLocalChain = chainId === 31337;
  const isProd = process.env.NODE_ENV === "production";

  if (isLocalChain && !isProd) {
    console.warn(
      "\n⚠️  ============================================================\n" +
        "⚠️  MAKER_PRIVATE_KEY not set — falling back to the well-known\n" +
        "⚠️  Anvil account #1 key. LOCAL DEV ONLY (chainId 31337).\n" +
        "⚠️  NEVER use this key on a live network — funds will be stolen.\n" +
        "⚠️  ============================================================\n"
    );
    return ANVIL_DEV_KEY;
  }

  throw new Error(
    `MAKER_PRIVATE_KEY is required (chainId=${chainId}, NODE_ENV=${process.env.NODE_ENV ?? "undefined"}). ` +
      "Refusing to start: the Anvil dev key is only permitted on local chain 31337 in non-production. " +
      "Set MAKER_PRIVATE_KEY to a real maker key."
  );
}

function loadConfig(): MakerConfig {
  const WHYPE = process.env.WHYPE_ADDRESS ?? "0x0000000000000000000000000000000000000001";
  const USDC = process.env.USDC_ADDRESS ?? "0x0000000000000000000000000000000000000002";
  const USDH = process.env.USDH_ADDRESS ?? "0x0000000000000000000000000000000000000003";

  const chainId = parseInt(process.env.CHAIN_ID ?? "31337");

  return {
    privateKey: resolveMakerPrivateKey(chainId),
    chainId,
    engineAddress:
      process.env.ENGINE_ADDRESS ?? "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    relayWsUrl: process.env.RELAY_WS_URL ?? "ws://127.0.0.1:8080",
    allowedUnderlying: [WHYPE],
    collateralTokens: {
      [USDC.toLowerCase()]: { decimals: 6, symbol: "USDC" },
      [USDH.toLowerCase()]: { decimals: 6, symbol: "USDH" },
    },
    risk: {
      maxNotionalPerCollateral: {
        [USDC.toLowerCase()]: 1_000_000n * 10n ** 6n,
        [USDH.toLowerCase()]: 1_000_000n * 10n ** 6n,
      },
      maxTenorSecs: 90 * 24 * 3600,
      maxStrikeDeviationPct: 0.5,
      maxDeltaPerExpiry: 100,
      minPremium: {
        [USDC.toLowerCase()]: 1000n,
        [USDH.toLowerCase()]: 1000n,
      },
    },
    quoteDeadlineSecs: 120,
  };
}

function getMarketData(): MarketData {
  const spotPriceUsd = parseFloat(process.env.HYPE_SPOT_USD ?? "25");
  return {
    spotPrice: BigInt(Math.round(spotPriceUsd * 1e18)),
    ivBps: parseInt(process.env.HYPE_IV_BPS ?? "8000"),
    riskFreeRateBps: parseInt(process.env.RISK_FREE_RATE_BPS ?? "500"),
  };
}

// ---------------------------------------------------------------
// RFQ Filter
// ---------------------------------------------------------------

function isRfqAcceptable(rfq: RFQ, config: MakerConfig): boolean {
  if (!config.allowedUnderlying.some((u) => u.toLowerCase() === rfq.underlying.toLowerCase())) {
    console.log(`  [SKIP] Underlying ${rfq.underlying} not allowed`);
    return false;
  }

  const collateralKey = rfq.collateral.toLowerCase();
  if (!config.collateralTokens[collateralKey]) {
    console.log(`  [SKIP] Collateral ${rfq.collateral} not allowed`);
    return false;
  }

  const expiryNum = Number(rfq.expiry);
  if (expiryNum % 86400 !== 28800) {
    console.log(`  [SKIP] Expiry not at 08:00 UTC`);
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (expiryNum <= now) {
    console.log(`  [SKIP] Expiry in the past`);
    return false;
  }

  return true;
}

// ---------------------------------------------------------------
// Main
// ---------------------------------------------------------------

async function main() {
  const config = loadConfig();
  const wallet = new Wallet(config.privateKey);
  const market = getMarketData();
  const pricingEngine = new StubPricingEngine();
  const riskState = new RiskState();

  let nonce = 0n;

  console.log("=== HyperQuote Maker Bot (Relay Mode) ===");
  console.log(`  Maker:    ${wallet.address}`);
  console.log(`  Chain ID: ${config.chainId}`);
  console.log(`  Engine:   ${config.engineAddress}`);
  console.log(`  Relay:    ${config.relayWsUrl}`);
  console.log(`  Spot:     $${Number(market.spotPrice) / 1e18}`);
  console.log("");

  function connect() {
    const ws = new WebSocket(config.relayWsUrl!);

    ws.on("open", () => {
      console.log("[CONNECTED] Relay WebSocket open\n");
    });

    ws.on("message", async (data) => {
      try {
        const msg: RelayMessage = JSON.parse(data.toString());

        if (msg.type === "PING") {
          ws.send(JSON.stringify({ type: "PONG", data: {} }));
          return;
        }

        if (msg.type === "ERROR") {
          console.error("[RELAY ERROR]", (msg.data as { message: string }).message);
          return;
        }

        if (msg.type === "RFQ_BROADCAST") {
          const broadcast = msg as unknown as RFQBroadcastMessage;
          const rfq = rfqFromJson(broadcast.data.rfq);
          const rfqId = broadcast.data.rfqId;
          const side = rfq.isCall ? "CC" : "CSP";

          console.log(
            `[RFQ] ${rfqId.slice(0, 14)}... ${side} K=$${Number(rfq.strike) / 1e18}` +
              ` Q=${Number(rfq.quantity) / 1e18} exp=${rfq.expiry}`,
          );

          // 1. Filter
          if (!isRfqAcceptable(rfq, config)) return;

          // 2. Price
          const collateralKey = rfq.collateral.toLowerCase();
          const cDec = config.collateralTokens[collateralKey]?.decimals ?? 6;
          const pricing = pricingEngine.price(rfq, market, cDec);
          console.log(
            `  [PRICE] premium=${pricing.premium} delta=${pricing.delta.toFixed(4)}` +
              ` iv=${(pricing.ivUsed * 100).toFixed(1)}%`,
          );

          // 3. Check min premium
          if (rfq.minPremium > 0n && pricing.premium < rfq.minPremium) {
            console.log(
              `  [SKIP] Premium ${pricing.premium} < minPremium ${rfq.minPremium}`,
            );
            return;
          }

          // 4. Risk
          const riskResult = checkRisk(rfq, market, config.risk, riskState, cDec, pricing.delta);
          if (!riskResult.passed) {
            console.log(`  [SKIP] Risk: ${riskResult.reason}`);
            return;
          }

          // 5. Build quote
          const now = BigInt(Math.floor(Date.now() / 1000));
          const quote: Quote = {
            maker: wallet.address,
            taker: "0x0000000000000000000000000000000000000000",
            underlying: rfq.underlying,
            collateral: rfq.collateral,
            isCall: rfq.isCall,
            isMakerSeller: false,
            strike: rfq.strike,
            quantity: rfq.quantity,
            premium: pricing.premium,
            expiry: rfq.expiry,
            deadline: now + BigInt(config.quoteDeadlineSecs),
            nonce: nonce,
          };

          // 6. Sign (EIP-712)
          const signature = await signQuote(
            wallet,
            quote,
            config.chainId,
            config.engineAddress,
          );

          // 7. Record risk
          const notional = computeNotional(rfq.strike, rfq.quantity, 18, cDec);
          riskState.recordQuote(
            rfq.collateral,
            rfq.expiry,
            notional,
            pricing.delta,
            rfq.isCall,
          );
          nonce += 1n;

          // 8. Submit to relay
          const submitMsg: QuoteSubmitMessage = {
            type: "QUOTE_SUBMIT",
            data: {
              rfqId,
              quote: quoteToJson(quote),
              makerSig: signature,
            },
          };
          ws.send(JSON.stringify(submitMsg));

          console.log(
            `  [QUOTE] Submitted nonce=${quote.nonce} premium=${pricing.premium}` +
              ` sig=${signature.slice(0, 18)}...`,
          );
          console.log("");
        }
      } catch (err) {
        console.error("[ERROR] Processing message:", err);
      }
    });

    ws.on("error", (err) => {
      console.error("[WS ERROR]", err.message);
    });

    ws.on("close", () => {
      console.log("[DISCONNECTED] Reconnecting in 3s...");
      setTimeout(connect, 3000);
    });

    // Keepalive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "PING", data: {} }));
      }
    }, 30_000);

    ws.on("close", () => clearInterval(pingInterval));
  }

  connect();
}

main().catch(console.error);
