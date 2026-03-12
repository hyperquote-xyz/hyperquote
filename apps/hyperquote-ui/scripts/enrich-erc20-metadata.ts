/**
 * scripts/enrich-erc20-metadata.ts
 *
 * For each ERC-20 address, call name(), symbol(), decimals() via HyperEVM RPC.
 * Skips tokens that fail. Prepends native HYPE entry.
 *
 * Uses viem (already a dependency via wagmi) for RPC calls.
 *
 * Reads RPC URL from env: NEXT_PUBLIC_HYPEREVM_RPC_URL
 *
 * Usage:
 *   npx ts-node scripts/enrich-erc20-metadata.ts
 *   (typically called from build-tokenlist.ts, not directly)
 */

import { createPublicClient, http, getAddress, type PublicClient } from "viem";
import { defineChain } from "viem/chains";

// ── Types ──

export interface TokenEntry {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl: string | null;
}

// ── Config ──

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1_500;
const BATCH_SIZE = 10; // concurrent RPC calls per batch
const BATCH_DELAY_MS = 500; // pause between batches to avoid rate limits

// Minimal ERC-20 ABI for metadata
const ERC20_ABI = [
  {
    name: "name",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

// Native HYPE entry — always included
const NATIVE_HYPE: TokenEntry = {
  address: "0x0000000000000000000000000000000000000000",
  symbol: "HYPE",
  name: "Hyperliquid Native Token",
  decimals: 18,
  logoUrl: null,
};

// ── Helpers ──

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function getRpcUrl(): string {
  const url = process.env.NEXT_PUBLIC_HYPEREVM_RPC_URL;
  if (!url) {
    console.error(
      "\n❌  NEXT_PUBLIC_HYPEREVM_RPC_URL is not set.\n" +
        "   Set it in .env.local or export it before running this script.\n" +
        "   Example: export NEXT_PUBLIC_HYPEREVM_RPC_URL=https://rpc.hyperliquid.xyz/evm\n"
    );
    process.exit(1);
  }
  return url;
}

function createClient(): PublicClient {
  const rpcUrl = getRpcUrl();

  // Define HyperEVM chain (chain ID may vary — using a generic definition)
  const hyperEVM = defineChain({
    id: parseInt(process.env.NEXT_PUBLIC_CHAIN_ID ?? "999"),
    name: "HyperEVM",
    nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
    rpcUrls: {
      default: { http: [rpcUrl] },
    },
  });

  return createPublicClient({
    chain: hyperEVM,
    transport: http(rpcUrl, { timeout: 15_000 }),
  });
}

/**
 * Fetch ERC-20 metadata for a single address with retries.
 * Returns null if the token cannot be read (not an ERC-20, reverts, etc.)
 */
async function fetchTokenMetadata(
  client: PublicClient,
  address: string
): Promise<TokenEntry | null> {
  const checksummed = getAddress(address) as `0x${string}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const [name, symbol, decimals] = await Promise.all([
        client.readContract({
          address: checksummed,
          abi: ERC20_ABI,
          functionName: "name",
        }),
        client.readContract({
          address: checksummed,
          abi: ERC20_ABI,
          functionName: "symbol",
        }),
        client.readContract({
          address: checksummed,
          abi: ERC20_ABI,
          functionName: "decimals",
        }),
      ]);

      // Validate responses
      if (
        typeof name !== "string" ||
        typeof symbol !== "string" ||
        typeof decimals !== "number"
      ) {
        console.warn(`[enrich] ⚠ ${checksummed}: unexpected types — skipping`);
        return null;
      }

      if (!symbol || symbol.length === 0) {
        console.warn(`[enrich] ⚠ ${checksummed}: empty symbol — skipping`);
        return null;
      }

      return {
        address: checksummed,
        symbol: symbol.trim(),
        name: (name ?? symbol).trim(),
        decimals: Number(decimals),
        logoUrl: null,
      };
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        console.warn(
          `[enrich] ⚠ ${checksummed}: attempt ${attempt}/${MAX_RETRIES} failed — retrying in ${RETRY_DELAY_MS}ms`
        );
        await sleep(RETRY_DELAY_MS * attempt);
      } else {
        console.warn(
          `[enrich] ✗ ${checksummed}: all ${MAX_RETRIES} attempts failed — skipping`
        );
        return null;
      }
    }
  }
  return null;
}

/**
 * Enrich a list of raw addresses into full TokenEntry objects.
 * Processes in batches to avoid rate limiting.
 */
export async function enrichTokens(
  addresses: string[]
): Promise<TokenEntry[]> {
  const client = createClient();
  const results: TokenEntry[] = [NATIVE_HYPE]; // Always include native HYPE
  const seen = new Set<string>([NATIVE_HYPE.address.toLowerCase()]);

  console.log(`[enrich] Enriching ${addresses.length} addresses via RPC…`);
  console.log(
    `[enrich] Batch size: ${BATCH_SIZE}, retries: ${MAX_RETRIES}\n`
  );

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    const batch = addresses.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(addresses.length / BATCH_SIZE);

    console.log(
      `[enrich] Batch ${batchNum}/${totalBatches} (${batch.length} tokens)…`
    );

    const batchResults = await Promise.all(
      batch.map((addr) => fetchTokenMetadata(client, addr))
    );

    for (const entry of batchResults) {
      if (entry) {
        const lower = entry.address.toLowerCase();
        if (!seen.has(lower)) {
          seen.add(lower);
          results.push(entry);
          succeeded++;
        }
      } else {
        failed++;
      }
    }

    // Pause between batches
    if (i + BATCH_SIZE < addresses.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log(
    `\n[enrich] Done: ${succeeded} succeeded, ${failed} failed, ${results.length} total (including native HYPE)`
  );

  return results;
}

// ── CLI entry point ──
if (require.main === module) {
  // When run directly, read addresses from stdin (one per line)
  const chunks: Buffer[] = [];
  process.stdin.on("data", (chunk) => chunks.push(chunk));
  process.stdin.on("end", async () => {
    const input = Buffer.concat(chunks).toString("utf-8").trim();
    let addresses: string[];

    try {
      // Try parsing as JSON array first
      addresses = JSON.parse(input);
    } catch {
      // Fall back to one-per-line
      addresses = input
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    }

    if (addresses.length === 0) {
      console.error("[enrich] No addresses provided on stdin");
      process.exit(1);
    }

    const tokens = await enrichTokens(addresses);
    console.log(JSON.stringify(tokens, null, 2));
    process.exit(0);
  });
}
