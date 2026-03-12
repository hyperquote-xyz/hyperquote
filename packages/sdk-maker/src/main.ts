/**
 * Example Maker Bot — reads RFQs from a mocked JSON feed.
 *
 * This is an offline demonstration of the full maker pipeline:
 *   Load RFQs → Filter → Price → Risk check → Build quote → Sign → Verify → Output
 *
 * No relay or network dependencies. Run with:
 *   npx tsx src/main.ts
 */

import { Wallet } from "ethers";

import { Quote, RFQ, MakerConfig, quoteToJson } from "./types.js";
import { signQuote } from "./signQuote.js";
import { verifyQuoteSignature } from "./verifyQuote.js";
import { StubPricingEngine, MarketData } from "./pricing.js";
import { RiskState, checkRisk, computeNotional } from "./risk.js";
import { computeRfqId } from "./rfqHash.js";

// ---------------------------------------------------------------
// Mock RFQ Feed — simulates inbound RFQs from a JSON source
// ---------------------------------------------------------------

/**
 * Generates a future 08:00 UTC timestamp for the given number of days out.
 */
function futureExpiry(daysOut: number): bigint {
  const now = Math.floor(Date.now() / 1000);
  const daySeconds = 86400;
  const eightAM = 28800; // 08:00 UTC in seconds since midnight
  // Next day at 08:00 UTC, plus extra days
  const todayMidnight = now - (now % daySeconds);
  const expiry = todayMidnight + eightAM + daysOut * daySeconds;
  // If that's in the past, bump by a day
  return BigInt(expiry > now ? expiry : expiry + daySeconds);
}

const WHYPE = "0x0000000000000000000000000000000000000001";
const USDC = "0x0000000000000000000000000000000000000002";
const USDH = "0x0000000000000000000000000000000000000003";

/**
 * Build a set of mock RFQs that simulate a real-time feed.
 * Timestamps are set to "now" so the staleness check passes.
 */
function buildMockRfqFeed(): RFQ[] {
  const now = BigInt(Math.floor(Date.now() / 1000));

  return [
    // 1. CSP — WHYPE/USDC, strike $25, 1 WHYPE, 7-day expiry
    {
      requester: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", // anvil account 2
      underlying: WHYPE,
      collateral: USDC,
      isCall: false,
      strike: 25_000000000000000000n, // $25 in 1e18
      quantity: 1_000000000000000000n, // 1 WHYPE
      expiry: futureExpiry(7),
      minPremium: 500_000n, // $0.50 in 1e6 USDC
      timestamp: now,
    },
    // 2. CC — WHYPE/USDC, strike $30, 5 WHYPE, 14-day expiry
    {
      requester: "0x90F79bf6EB2c4f870365E785982E1f101E93b906", // anvil account 3
      underlying: WHYPE,
      collateral: USDC,
      isCall: true,
      strike: 30_000000000000000000n, // $30
      quantity: 5_000000000000000000n, // 5 WHYPE
      expiry: futureExpiry(14),
      minPremium: 2_000_000n, // $2.00
      timestamp: now,
    },
    // 3. CSP — WHYPE/USDH, strike $20, 10 WHYPE, 30-day expiry
    {
      requester: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65", // anvil account 4
      underlying: WHYPE,
      collateral: USDH,
      isCall: false,
      strike: 20_000000000000000000n, // $20
      quantity: 10_000000000000000000n, // 10 WHYPE
      expiry: futureExpiry(30),
      minPremium: 10_000_000n, // $10.00
      timestamp: now,
    },
    // 4. CSP — unknown collateral token (should be filtered)
    {
      requester: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc", // anvil account 5
      underlying: WHYPE,
      collateral: "0x000000000000000000000000000000000000DEAD",
      isCall: false,
      strike: 25_000000000000000000n,
      quantity: 1_000000000000000000n,
      expiry: futureExpiry(7),
      minPremium: 100_000n,
      timestamp: now,
    },
    // 5. CSP — strike way too far OTM (should fail risk check)
    {
      requester: "0x976EA74026E726554dB657fA54763abd0C3a0aa9", // anvil account 6
      underlying: WHYPE,
      collateral: USDC,
      isCall: false,
      strike: 5_000000000000000000n, // $5 — 80% below $25 spot
      quantity: 1_000000000000000000n,
      expiry: futureExpiry(7),
      minPremium: 100_000n,
      timestamp: now,
    },
    // 6. CC — WHYPE/USDC, ATM strike, 3-day expiry (short dated)
    {
      requester: "0x14dC79964da2c08dABa46e91166b4A68A6d85766", // anvil account 7
      underlying: WHYPE,
      collateral: USDC,
      isCall: true,
      strike: 25_000000000000000000n, // ATM at $25
      quantity: 2_000000000000000000n, // 2 WHYPE
      expiry: futureExpiry(3),
      minPremium: 300_000n, // $0.30
      timestamp: now,
    },
  ];
}

// ---------------------------------------------------------------
// Default Config (no relay, offline mode)
// ---------------------------------------------------------------

function loadConfig(): MakerConfig {
  const WHYPE = "0x0000000000000000000000000000000000000001";
  const USDC = "0x0000000000000000000000000000000000000002";
  const USDH = "0x0000000000000000000000000000000000000003";

  return {
    // Anvil account 1 (default maker)
    privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    chainId: 31337,
    engineAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    allowedUnderlying: [WHYPE],
    collateralTokens: {
      [USDC.toLowerCase()]: { decimals: 6, symbol: "USDC" },
      [USDH.toLowerCase()]: { decimals: 6, symbol: "USDH" },
    },
    risk: {
      maxNotionalPerCollateral: {
        [USDC.toLowerCase()]: 1_000_000n * 10n ** 6n, // $1M
        [USDH.toLowerCase()]: 1_000_000n * 10n ** 6n,
      },
      maxTenorSecs: 90 * 24 * 3600, // 90 days
      maxStrikeDeviationPct: 0.5, // 50% from spot
      maxDeltaPerExpiry: 100,
      minPremium: {
        [USDC.toLowerCase()]: 1000n, // 0.001 USDC
        [USDH.toLowerCase()]: 1000n,
      },
    },
    quoteDeadlineSecs: 120,
  };
}

// ---------------------------------------------------------------
// Stub market data
// ---------------------------------------------------------------

function getMarketData(): MarketData {
  return {
    spotPrice: 25_000000000000000000n, // $25.00
    ivBps: 8000, // 80% annualized IV
    riskFreeRateBps: 500, // 5%
  };
}

// ---------------------------------------------------------------
// RFQ Filter
// ---------------------------------------------------------------

function isRfqAcceptable(rfq: RFQ, config: MakerConfig): { ok: boolean; reason?: string } {
  // Check underlying
  if (!config.allowedUnderlying.some((u) => u.toLowerCase() === rfq.underlying.toLowerCase())) {
    return { ok: false, reason: `Underlying ${rfq.underlying} not in allowlist` };
  }

  // Check collateral
  const collateralKey = rfq.collateral.toLowerCase();
  if (!config.collateralTokens[collateralKey]) {
    return { ok: false, reason: `Collateral ${rfq.collateral} not in allowlist` };
  }

  // Check expiry is 08:00 UTC
  const expiryNum = Number(rfq.expiry);
  if (expiryNum % 86400 !== 28800) {
    return { ok: false, reason: `Expiry not at 08:00 UTC (${expiryNum % 86400}s offset)` };
  }

  // Check expiry is in the future
  const now = Math.floor(Date.now() / 1000);
  if (expiryNum <= now) {
    return { ok: false, reason: "Expiry is in the past" };
  }

  // Staleness check relaxed in mock mode — allow up to 600s
  const rfqAge = now - Number(rfq.timestamp);
  if (rfqAge > 600) {
    return { ok: false, reason: `RFQ is stale (${rfqAge}s old)` };
  }

  return { ok: true };
}

// ---------------------------------------------------------------
// Signed Quote Output
// ---------------------------------------------------------------

interface SignedQuoteOutput {
  rfqId: string;
  quote: Quote;
  quoteJson: ReturnType<typeof quoteToJson>;
  signature: string;
  pricing: { premium: bigint; delta: number; ivUsed: number; fairValue: bigint };
  verified: boolean;
}

// ---------------------------------------------------------------
// Main — process mocked JSON feed
// ---------------------------------------------------------------

async function main() {
  const config = loadConfig();
  const wallet = new Wallet(config.privateKey);
  const market = getMarketData();
  const pricingEngine = new StubPricingEngine();
  const riskState = new RiskState();

  console.log("========================================");
  console.log("  HyperQuote Maker Bot (Mock Feed)");
  console.log("========================================");
  console.log(`  Maker:    ${wallet.address}`);
  console.log(`  Chain ID: ${config.chainId}`);
  console.log(`  Engine:   ${config.engineAddress}`);
  console.log(`  Spot:     $${Number(market.spotPrice) / 1e18}`);
  console.log(`  IV:       ${market.ivBps / 100}%`);
  console.log("");

  // Load mock RFQ feed
  const rfqFeed = buildMockRfqFeed();
  console.log(`Loaded ${rfqFeed.length} RFQs from mock feed\n`);

  let nonce = 0n;
  const results: SignedQuoteOutput[] = [];
  const skipped: { rfqId: string; reason: string }[] = [];

  for (let i = 0; i < rfqFeed.length; i++) {
    const rfq = rfqFeed[i];
    const rfqId = computeRfqId(rfq);
    const label = `RFQ #${i + 1}`;
    const side = rfq.isCall ? "CC" : "CSP";
    const strikeUsd = Number(rfq.strike) / 1e18;
    const qtyUnits = Number(rfq.quantity) / 1e18;

    console.log(`--- ${label} [${rfqId.slice(0, 14)}...] ---`);
    console.log(`  ${side} WHYPE K=$${strikeUsd} Q=${qtyUnits} exp=${rfq.expiry}`);

    // Step 1: Filter
    const filter = isRfqAcceptable(rfq, config);
    if (!filter.ok) {
      console.log(`  SKIP: ${filter.reason}\n`);
      skipped.push({ rfqId, reason: filter.reason! });
      continue;
    }

    // Step 2: Get collateral decimals
    const collateralKey = rfq.collateral.toLowerCase();
    const cDec = config.collateralTokens[collateralKey]?.decimals ?? 6;

    // Step 3: Price
    const pricing = pricingEngine.price(rfq, market, cDec);
    const premiumUsd = Number(pricing.premium) / 10 ** cDec;
    console.log(`  PRICE: premium=$${premiumUsd.toFixed(4)} (${pricing.premium} units) delta=${pricing.delta.toFixed(4)} iv=${(pricing.ivUsed * 100).toFixed(1)}%`);

    // Step 4: Check min premium
    if (rfq.minPremium > 0n && pricing.premium < rfq.minPremium) {
      const reason = `Premium ${pricing.premium} below seller minPremium ${rfq.minPremium}`;
      console.log(`  SKIP: ${reason}\n`);
      skipped.push({ rfqId, reason });
      continue;
    }

    // Step 5: Risk checks
    const riskResult = checkRisk(rfq, market, config.risk, riskState, cDec, pricing.delta);
    if (!riskResult.passed) {
      console.log(`  SKIP: Risk — ${riskResult.reason}\n`);
      skipped.push({ rfqId, reason: `Risk: ${riskResult.reason}` });
      continue;
    }

    // Step 6: Build quote
    const now = BigInt(Math.floor(Date.now() / 1000));
    const quote: Quote = {
      maker: wallet.address,
      taker: "0x0000000000000000000000000000000000000000", // open quote
      underlying: rfq.underlying,
      collateral: rfq.collateral,
      isCall: rfq.isCall,
      isMakerSeller: false, // V1: maker is always buyer
      strike: rfq.strike,
      quantity: rfq.quantity,
      premium: pricing.premium,
      expiry: rfq.expiry,
      deadline: now + BigInt(config.quoteDeadlineSecs),
      nonce: nonce,
    };

    // Step 7: Sign (EIP-712)
    const signature = await signQuote(wallet, quote, config.chainId, config.engineAddress);

    // Step 8: Verify (round-trip check)
    const verified = verifyQuoteSignature(quote, signature, config.chainId, config.engineAddress);

    // Step 9: Record risk exposure
    const notional = computeNotional(rfq.strike, rfq.quantity, 18, cDec);
    riskState.recordQuote(rfq.collateral, rfq.expiry, notional, pricing.delta, rfq.isCall);

    nonce += 1n;

    const output: SignedQuoteOutput = {
      rfqId,
      quote,
      quoteJson: quoteToJson(quote),
      signature,
      pricing,
      verified,
    };
    results.push(output);

    console.log(`  QUOTE: nonce=${quote.nonce} deadline=${quote.deadline}`);
    console.log(`  SIG:   ${signature.slice(0, 20)}...${signature.slice(-8)}`);
    console.log(`  VERIFY: ${verified ? "OK" : "FAILED"}`);
    console.log("");
  }

  // Summary
  console.log("========================================");
  console.log("  Summary");
  console.log("========================================");
  console.log(`  Total RFQs:   ${rfqFeed.length}`);
  console.log(`  Quoted:       ${results.length}`);
  console.log(`  Skipped:      ${skipped.length}`);
  console.log("");

  if (skipped.length > 0) {
    console.log("  Skipped RFQs:");
    for (const s of skipped) {
      console.log(`    ${s.rfqId.slice(0, 14)}... — ${s.reason}`);
    }
    console.log("");
  }

  if (results.length > 0) {
    console.log("  Signed Quotes:");
    for (const r of results) {
      const side = r.quote.isCall ? "CC" : "CSP";
      const premiumUsd = Number(r.pricing.premium) / 1e6;
      console.log(
        `    ${r.rfqId.slice(0, 14)}... ${side} K=$${Number(r.quote.strike) / 1e18} Q=${Number(r.quote.quantity) / 1e18} P=$${premiumUsd.toFixed(4)} delta=${r.pricing.delta.toFixed(4)} ${r.verified ? "sig-OK" : "sig-FAIL"}`,
      );
    }
    console.log("");

    // Output full JSON for first quote (demonstration)
    console.log("  Example full JSON output (first quote):");
    const first = results[0];
    console.log(JSON.stringify({
      rfqId: first.rfqId,
      quote: first.quoteJson,
      signature: first.signature,
      verified: first.verified,
    }, null, 2));
  }

  console.log("\nDone.");
}

main().catch(console.error);
