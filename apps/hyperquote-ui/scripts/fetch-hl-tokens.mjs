/**
 * fetch-hl-tokens.mjs
 *
 * Build-time script that fetches the Hyperliquid spotMeta API and generates
 * a validated token JSON file for the UI.
 *
 * Key data model from spotMeta:
 *   - tokens[] = flat array of all ~445 individual tokens
 *   - universe[] = spot pairs (274 entries), each with { tokens: [baseIdx, quoteIdx], name, index }
 *
 * The l2Book coin identifier:
 *   - For canonical pairs (e.g. "PURR/USDC"): use the token symbol (e.g. "PURR")
 *   - For non-canonical pairs (e.g. "@107"): use "@{universeIndex}" format
 *
 * EVM decimals:
 *   - spotMeta provides `evm_extra_wei_decimals` on each evmContract
 *   - EVM decimals = weiDecimals + evm_extra_wei_decimals
 *   - We also verify via on-chain eth_call as a sanity check
 *
 * Steps:
 *   1. Fetch spotMeta from HL API
 *   2. Build token-to-universe mapping (which pairs trade each token)
 *   3. Compute EVM decimals from weiDecimals + evm_extra_wei_decimals
 *   4. Derive l2Book coin identifier for each token
 *   5. Validate coin identifiers via l2Book API
 *   6. Write output files
 *
 * Usage:
 *   node scripts/fetch-hl-tokens.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DATA = path.resolve(__dirname, "..", "src", "data");

const HL_INFO = "https://api.hyperliquid.xyz/info";
const HL_RPC = "https://rpc.hyperliquid.xyz/evm";

// ERC-20 function selector for decimals()
const DECIMALS_SELECTOR = "0x313ce567";

// Concurrency control
const CONCURRENCY = 10;
const L2BOOK_DELAY_MS = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function batchProcess(items, fn, concurrency) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Step 1: Fetch spotMeta
// ---------------------------------------------------------------------------

async function fetchSpotMeta() {
  console.log("Fetching spotMeta from Hyperliquid...");
  const data = await fetchJson(HL_INFO, { type: "spotMeta" });
  const { universe, tokens } = data;
  if (!Array.isArray(universe) || !Array.isArray(tokens)) {
    throw new Error("Unexpected spotMeta shape");
  }
  console.log(`  ${universe.length} spot pairs, ${tokens.length} tokens`);
  return { universe, tokens };
}

// ---------------------------------------------------------------------------
// Step 2-3: Build token list
// ---------------------------------------------------------------------------

function buildTokenList(universe, tokens) {
  // Build map: tokenIndex -> list of universe entries where this token is the BASE
  const baseUniverseMap = new Map();
  for (const u of universe) {
    const [baseIdx] = u.tokens;
    if (!baseUniverseMap.has(baseIdx)) baseUniverseMap.set(baseIdx, []);
    baseUniverseMap.get(baseIdx).push(u);
  }

  const result = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const evmContract = tok.evmContract;
    const evmAddr = evmContract?.address ?? null;

    // Compute EVM decimals from spotMeta
    // evmDecimals = weiDecimals + evm_extra_wei_decimals
    let evmDecimals = null;
    if (evmContract && typeof evmContract.evm_extra_wei_decimals === "number") {
      evmDecimals = tok.weiDecimals + evmContract.evm_extra_wei_decimals;
    }

    // Derive l2Book coin identifier
    // Look at universe entries where this token is the base token
    const universeEntries = baseUniverseMap.get(tok.index) ?? [];
    let hyperliquidCoin = null;

    if (universeEntries.length > 0) {
      // Prefer the canonical pair, then the first available
      const canonical = universeEntries.find((u) => u.isCanonical);
      const best = canonical || universeEntries[0];

      if (best.name.includes("/")) {
        // Canonical pair like "PURR/USDC" — use token symbol directly
        hyperliquidCoin = tok.name;
      } else {
        // Non-canonical pair like "@107" — use as-is
        hyperliquidCoin = best.name;
      }
    }

    result.push({
      symbol: tok.name,
      name: tok.fullName || tok.name,
      index: tok.index,
      hypercoreAddress: tok.tokenId,
      evmAddress: evmAddr,
      evmDecimals,
      hlWeiDecimals: tok.weiDecimals,
      szDecimals: tok.szDecimals ?? 0,
      isCanonical: tok.isCanonical ?? false,
      hyperliquidCoin,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Step 4: Validate l2Book coin identifiers
// ---------------------------------------------------------------------------

async function validateCoinIdentifier(coin) {
  try {
    const data = await fetchJson(HL_INFO, { type: "l2Book", coin });
    const levels = data?.levels;
    return levels && Array.isArray(levels) && levels.length >= 2;
  } catch {
    return false;
  }
}

async function validateAllCoins(tokens) {
  // Only validate coins for EVM-linked tokens (the ones we'll use)
  const coinsToValidate = [
    ...new Set(tokens.filter((t) => t.evmAddress && t.hyperliquidCoin).map((t) => t.hyperliquidCoin)),
  ];
  console.log(`\nValidating ${coinsToValidate.length} l2Book coin identifiers...`);

  const validCoins = new Set();
  const invalidCoins = [];
  let processed = 0;

  await batchProcess(coinsToValidate, async (coin) => {
    await sleep(L2BOOK_DELAY_MS);
    const valid = await validateCoinIdentifier(coin);
    processed++;
    if (valid) {
      validCoins.add(coin);
    } else {
      invalidCoins.push(coin);
    }
    if (processed % 20 === 0) {
      console.log(`  Validated ${processed}/${coinsToValidate.length}...`);
    }
  }, CONCURRENCY);

  console.log(`  Valid: ${validCoins.size}, Invalid: ${invalidCoins.length}`);
  if (invalidCoins.length > 0) {
    console.warn(`  Invalid (excluded): ${invalidCoins.join(", ")}`);
  }

  // Null out invalid coins
  for (const tok of tokens) {
    if (tok.hyperliquidCoin && !validCoins.has(tok.hyperliquidCoin)) {
      tok.hyperliquidCoin = null;
    }
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Step 5: Verify EVM decimals via on-chain call (spot-check)
// ---------------------------------------------------------------------------

async function fetchEvmDecimals(address) {
  try {
    const res = await fetch(HL_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: address, data: DECIMALS_SELECTOR }, "latest"],
      }),
    });
    const json = await res.json();
    if (json.error || !json.result || json.result === "0x") return null;
    const dec = parseInt(json.result, 16);
    if (isNaN(dec) || dec < 0 || dec > 36) return null;
    return dec;
  } catch {
    return null;
  }
}

async function verifyEvmDecimals(tokens) {
  const evmTokens = tokens.filter((t) => t.evmAddress && t.evmDecimals !== null);
  console.log(`\nVerifying EVM decimals for ${evmTokens.length} tokens (on-chain check)...`);

  let verified = 0;
  let mismatches = 0;
  let rpcFailures = 0;

  await batchProcess(evmTokens, async (tok) => {
    const onChainDec = await fetchEvmDecimals(tok.evmAddress);
    if (onChainDec === null) {
      rpcFailures++;
      return;
    }
    verified++;
    if (onChainDec !== tok.evmDecimals) {
      mismatches++;
      console.warn(
        `  MISMATCH: ${tok.symbol} computed=${tok.evmDecimals} on-chain=${onChainDec} — using on-chain`
      );
      tok.evmDecimals = onChainDec;
    }
  }, CONCURRENCY);

  console.log(`  Verified: ${verified}, Mismatches fixed: ${mismatches}, RPC failures: ${rpcFailures}`);

  // For tokens where computed decimals AND RPC failed, drop the token
  const tokensWithNoDecimals = tokens.filter((t) => t.evmAddress && t.evmDecimals === null);
  if (tokensWithNoDecimals.length > 0) {
    console.warn(`  ${tokensWithNoDecimals.length} EVM tokens have no decimals (will be excluded)`);
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Step 6: Write output files
// ---------------------------------------------------------------------------

function writeOutput(tokens) {
  if (!fs.existsSync(SRC_DATA)) {
    fs.mkdirSync(SRC_DATA, { recursive: true });
  }

  // EVM-linked tokens only (for UI token list)
  const evmTokens = tokens
    .filter((t) => t.evmAddress && t.evmDecimals !== null)
    .map((t) => ({
      symbol: t.symbol,
      name: t.name,
      index: t.index,
      hypercoreAddress: t.hypercoreAddress,
      evmAddress: t.evmAddress.toLowerCase(),
      evmDecimals: t.evmDecimals,
      hlWeiDecimals: t.hlWeiDecimals,
      szDecimals: t.szDecimals,
      isCanonical: t.isCanonical,
      hyperliquidCoin: t.hyperliquidCoin,
    }));

  const evmPath = path.join(SRC_DATA, "hl-spot-tokens.json");
  fs.writeFileSync(evmPath, JSON.stringify(evmTokens, null, 2));
  console.log(`\nWrote ${evmTokens.length} EVM-linked tokens -> ${evmPath}`);

  // All tokens including hypercore-only (for benchmarking)
  const allTokens = tokens.map((t) => ({
    symbol: t.symbol,
    name: t.name,
    index: t.index,
    hypercoreAddress: t.hypercoreAddress,
    evmAddress: t.evmAddress?.toLowerCase() ?? null,
    evmDecimals: t.evmDecimals,
    hlWeiDecimals: t.hlWeiDecimals,
    szDecimals: t.szDecimals,
    isCanonical: t.isCanonical,
    hyperliquidCoin: t.hyperliquidCoin,
  }));

  const allPath = path.join(SRC_DATA, "hl-spot-tokens-all.json");
  fs.writeFileSync(allPath, JSON.stringify(allTokens, null, 2));
  console.log(`Wrote ${allTokens.length} total tokens -> ${allPath}`);

  // Summary stats
  const withCoin = evmTokens.filter((t) => t.hyperliquidCoin).length;
  const decMismatch = evmTokens.filter((t) => t.evmDecimals !== t.hlWeiDecimals).length;
  console.log(`\nSummary:`);
  console.log(`  EVM-linked tokens: ${evmTokens.length}`);
  console.log(`  With valid l2Book coin: ${withCoin}`);
  console.log(`  Decimal mismatches (evmDecimals != hlWeiDecimals): ${decMismatch}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Hyperliquid spotMeta Token Fetcher ===\n");

  const { universe, tokens: rawTokens } = await fetchSpotMeta();

  let tokens = buildTokenList(universe, rawTokens);
  console.log(`  Built ${tokens.length} token entries`);

  // Show key tokens
  const keySymbols = ["USDC", "PURR", "HYPE", "USDH", "JEFF", "KHYPE"];
  for (const sym of keySymbols) {
    const t = tokens.find((x) => x.symbol === sym);
    if (t) {
      console.log(
        `  ${sym}: evmDec=${t.evmDecimals} hlDec=${t.hlWeiDecimals} coin=${t.hyperliquidCoin} evm=${t.evmAddress ? "yes" : "no"}`
      );
    }
  }

  tokens = await validateAllCoins(tokens);
  tokens = await verifyEvmDecimals(tokens);
  writeOutput(tokens);

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("\nFATAL:", err.message);
  process.exit(1);
});
