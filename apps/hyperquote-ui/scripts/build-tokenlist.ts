/**
 * scripts/build-tokenlist.ts
 *
 * Orchestrator: scrape PRJX → enrich via RPC → write src/data/tokens.json
 *
 * Usage:
 *   npm run tokens:build
 *   # or directly:
 *   npx ts-node scripts/build-tokenlist.ts
 *
 * Requires:
 *   - NEXT_PUBLIC_HYPEREVM_RPC_URL set in env or .env.local
 *   - playwright installed (npx playwright install chromium)
 *   - viem available (from wagmi dependency)
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

// Load .env.local if present (for NEXT_PUBLIC_HYPEREVM_RPC_URL)
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { scrapePRJXTokens } from "./scrape-prjx-tokens";
import { enrichTokens, type TokenEntry } from "./enrich-erc20-metadata";

// ── Config ──

const OUTPUT_PATH = path.resolve(__dirname, "../src/data/tokens.json");

// ── Main ──

async function main() {
  const startTime = Date.now();

  console.log("═══════════════════════════════════════════");
  console.log("  HyperQuote Token List Builder");
  console.log("═══════════════════════════════════════════\n");

  // ── Step 0: Validate env ──
  const rpcUrl = process.env.NEXT_PUBLIC_HYPEREVM_RPC_URL;
  if (!rpcUrl) {
    console.error(
      "❌  NEXT_PUBLIC_HYPEREVM_RPC_URL is not set.\n" +
        "   Set it in .env.local or export it:\n" +
        "     export NEXT_PUBLIC_HYPEREVM_RPC_URL=https://rpc.hyperliquid.xyz/evm\n"
    );
    process.exit(1);
  }
  console.log(`✓ RPC URL: ${rpcUrl.slice(0, 40)}…\n`);

  // ── Step 1: Scrape PRJX ──
  console.log("── Step 1: Scraping PRJX liquidity pools ──\n");

  let rawAddresses: string[];
  try {
    rawAddresses = await scrapePRJXTokens();
  } catch (err) {
    console.error("❌  Scraping failed:", err);
    process.exit(1);
  }

  if (rawAddresses.length === 0) {
    console.error(
      "❌  No token addresses found. The page structure may have changed.\n" +
        "   Try running: npx ts-node scripts/scrape-prjx-tokens.ts\n" +
        "   and inspecting the output."
    );
    process.exit(1);
  }
  console.log(`\n✓ Scraped ${rawAddresses.length} unique addresses\n`);

  // ── Step 2: Enrich via RPC ──
  console.log("── Step 2: Enriching ERC-20 metadata via RPC ──\n");

  let tokens: TokenEntry[];
  try {
    tokens = await enrichTokens(rawAddresses);
  } catch (err) {
    console.error("❌  Enrichment failed:", err);
    process.exit(1);
  }

  if (tokens.length === 0) {
    console.error("❌  No tokens enriched successfully.");
    process.exit(1);
  }

  // Sort by symbol for readability
  tokens.sort((a, b) => {
    // Native HYPE always first
    if (a.address === "0x0000000000000000000000000000000000000000") return -1;
    if (b.address === "0x0000000000000000000000000000000000000000") return 1;
    return a.symbol.localeCompare(b.symbol);
  });

  // ── Step 3: Write output ──
  console.log("\n── Step 3: Writing token list ──\n");

  // Ensure directory exists
  const dir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const json = JSON.stringify(tokens, null, 2) + "\n";
  fs.writeFileSync(OUTPUT_PATH, json, "utf-8");

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`✓ Wrote ${tokens.length} tokens to: ${OUTPUT_PATH}`);
  console.log(`✓ Completed in ${elapsed}s\n`);

  // ── Summary ──
  console.log("═══════════════════════════════════════════");
  console.log("  Token List Summary");
  console.log("═══════════════════════════════════════════");
  console.log(`  Total tokens:  ${tokens.length}`);
  console.log(`  Native:        HYPE`);
  console.log(
    `  ERC-20:        ${tokens.filter((t) => t.address !== "0x0000000000000000000000000000000000000000").length}`
  );
  console.log(`  Output:        ${OUTPUT_PATH}`);
  console.log("═══════════════════════════════════════════\n");

  // Print first few tokens as preview
  console.log("Preview (first 10):");
  tokens.slice(0, 10).forEach((t) => {
    console.log(
      `  ${t.symbol.padEnd(10)} ${t.decimals}d  ${t.address}`
    );
  });
  if (tokens.length > 10) {
    console.log(`  … and ${tokens.length - 10} more`);
  }
}

main().catch((err) => {
  console.error("❌  Unhandled error:", err);
  process.exit(1);
});
