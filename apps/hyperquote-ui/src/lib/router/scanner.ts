/**
 * Pool Scanner — Phase 3
 *
 * Scans factory contracts for pool creation events and upserts pools
 * into the database. Supports:
 *   - Historical backfill (scan from deployment block to latest)
 *   - Incremental scan (scan from last checkpoint to latest)
 *   - Auto token creation (fetch ERC20 metadata for unknown tokens)
 *   - Idempotent upserts (safe to re-scan same range)
 *
 * Scanner reads protocol_connectors to determine:
 *   - Which factory address to scan
 *   - Which ABI to use (factoryAbiId → ABI registry)
 *   - What pool type to assign (poolTypeHint)
 *
 * Block range chunking:
 *   Many RPCs limit getLogs to ~2000-10000 blocks per request.
 *   We chunk at BLOCK_CHUNK_SIZE and scan sequentially.
 */

import {
  type AbiEvent,
  type Address,
  type Log,
  decodeEventLog,
} from "viem";
import { normalizeAddress } from "@/lib/router/address";
import { prisma } from "@/lib/db";
import { publicClient } from "@/lib/router/client";
import {
  FACTORY_ABI_REGISTRY,
  ERC20_METADATA_ABI,
  type FactoryAbiEntry,
} from "@/lib/router/abis";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Max blocks per getLogs call.
 * HyperEVM public RPC (rpc.hyperliquid.xyz) limits to 1000 blocks.
 * Paid RPCs may support larger ranges — override via SOR_BLOCK_CHUNK_SIZE env.
 */
const BLOCK_CHUNK_SIZE = BigInt(
  process.env.SOR_BLOCK_CHUNK_SIZE || "1000"
);

/** Delay between getLogs chunks to avoid rate limiting (ms) */
const CHUNK_DELAY_MS = Number(process.env.SOR_CHUNK_DELAY_MS || "100");

/** Default start block if no checkpoint exists */
const DEFAULT_START_BLOCK = 0n;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScanResult {
  slug: string;
  factoryAddress: string;
  scannedFromBlock: bigint;
  scannedToBlock: bigint;
  eventsFound: number;
  poolsCreated: number;
  poolsSkipped: number;
  tokensCreated: number;
  errors: string[];
}

/** Small delay to avoid RPC rate limiting */
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ScanAllResult {
  timestamp: string;
  latestBlock: bigint;
  protocols: ScanResult[];
  totalPoolsCreated: number;
  totalTokensCreated: number;
  totalErrors: number;
}

// ---------------------------------------------------------------------------
// Token Auto-Creation
// ---------------------------------------------------------------------------

/**
 * Ensure a token exists in the DB. If not, fetch metadata from chain
 * and create it. Returns true if the token was created.
 */
async function ensureToken(address: string): Promise<boolean> {
  const normalized = normalizeAddress(address);

  // Check if already exists
  const existing = await prisma.token.findUnique({
    where: { address: normalized },
    select: { address: true },
  });
  if (existing) return false;

  // Fetch on-chain metadata (RPC accepts any case)
  let symbol = "UNKNOWN";
  let name = "Unknown Token";
  let decimals = 18;

  try {
    const [symbolResult, nameResult, decimalsResult] = await Promise.allSettled([
      publicClient.readContract({
        address: normalized as Address,
        abi: ERC20_METADATA_ABI,
        functionName: "symbol",
      }),
      publicClient.readContract({
        address: normalized as Address,
        abi: ERC20_METADATA_ABI,
        functionName: "name",
      }),
      publicClient.readContract({
        address: normalized as Address,
        abi: ERC20_METADATA_ABI,
        functionName: "decimals",
      }),
    ]);

    if (symbolResult.status === "fulfilled") symbol = symbolResult.value as string;
    if (nameResult.status === "fulfilled") name = nameResult.value as string;
    if (decimalsResult.status === "fulfilled") decimals = Number(decimalsResult.value);
  } catch (err) {
    console.warn(`[scanner] Failed to fetch metadata for ${normalized}:`, err);
  }

  // Create token (discovered, not core) — always lowercase address
  await prisma.token.create({
    data: {
      address: normalized,
      symbol,
      name,
      decimals,
      isIntermediateAllowed: false, // discovered tokens start as non-intermediate
      tags: JSON.stringify(["discovered"]),
    },
  });

  console.log(`[scanner]   + Token ${symbol} (${normalized.slice(0, 10)}..., ${decimals} dec)`);
  return true;
}

// ---------------------------------------------------------------------------
// Single Protocol Scanner
// ---------------------------------------------------------------------------

/**
 * Scan a single protocol's factory for pool creation events.
 *
 * @param slug - Protocol slug (FK to protocol_registry)
 * @param fromBlock - Override start block (default: resume from last scan)
 */
export async function scanProtocol(
  slug: string,
  fromBlock?: bigint
): Promise<ScanResult> {
  const result: ScanResult = {
    slug,
    factoryAddress: "",
    scannedFromBlock: 0n,
    scannedToBlock: 0n,
    eventsFound: 0,
    poolsCreated: 0,
    poolsSkipped: 0,
    tokensCreated: 0,
    errors: [],
  };

  // ── Load connector config ──
  const connector = await prisma.protocolConnector.findUnique({
    where: { slug },
    include: { protocol: { select: { name: true, status: true } } },
  });

  if (!connector) {
    result.errors.push(`No connector configured for ${slug}`);
    return result;
  }

  if (connector.protocol.status !== "ACTIVE") {
    result.errors.push(`Protocol ${slug} is ${connector.protocol.status}, skipping`);
    return result;
  }

  if (connector.discoveryMethod !== "FACTORY_EVENTS") {
    result.errors.push(`Protocol ${slug} uses ${connector.discoveryMethod}, not FACTORY_EVENTS`);
    return result;
  }

  // ── Resolve factory ABI ──
  const abiEntry = FACTORY_ABI_REGISTRY[connector.factoryAbiId];
  if (!abiEntry) {
    result.errors.push(`Unknown factoryAbiId: ${connector.factoryAbiId}`);
    return result;
  }

  // ── Parse factory addresses ──
  let factoryAddresses: Record<string, string>;
  try {
    factoryAddresses = JSON.parse(connector.factoryAddresses);
  } catch {
    result.errors.push(`Invalid factoryAddresses JSON for ${slug}`);
    return result;
  }

  // Get the first non-zero factory address (skip metadata keys like startBlock)
  const factoryAddr = Object.entries(factoryAddresses).find(
    ([key, addr]) =>
      key !== "startBlock" &&
      addr !== "0x0000000000000000000000000000000000000000"
  )?.[1];

  if (!factoryAddr) {
    result.errors.push(`No valid factory address for ${slug} (all are zero)`);
    return result;
  }

  result.factoryAddress = factoryAddr;

  // Read optional startBlock from config (deployment block)
  const configStartBlock = factoryAddresses.startBlock
    ? BigInt(factoryAddresses.startBlock)
    : DEFAULT_START_BLOCK;

  // ── Parse pool type hint ──
  let defaultPoolType = "V2";
  if (connector.poolTypeHint) {
    try {
      const hint = JSON.parse(connector.poolTypeHint);
      defaultPoolType = hint.default || "V2";
    } catch {
      // ignore
    }
  }

  // ── Determine block range ──
  const latestBlock = await publicClient.getBlockNumber();

  // Find the highest block we've already scanned for this protocol
  let startBlock: bigint;
  if (fromBlock !== undefined) {
    startBlock = fromBlock;
  } else {
    const lastPool = await prisma.pool.findFirst({
      where: { slug },
      orderBy: { createdBlock: "desc" },
      select: { createdBlock: true },
    });
    startBlock = lastPool?.createdBlock
      ? BigInt(lastPool.createdBlock) + 1n
      : configStartBlock;
  }

  result.scannedFromBlock = startBlock;
  result.scannedToBlock = latestBlock;

  if (startBlock > latestBlock) {
    console.log(`[scanner] ${slug}: already up to date (block ${latestBlock})`);
    return result;
  }

  console.log(
    `[scanner] ${slug}: scanning ${factoryAddr.slice(0, 10)}... ` +
      `blocks ${startBlock}→${latestBlock} (${latestBlock - startBlock + 1n} blocks)`
  );

  // ── Chunk and scan ──
  const totalBlocks = latestBlock - startBlock + 1n;
  let current = startBlock;
  let chunkCount = 0;
  while (current <= latestBlock) {
    const chunkEnd =
      current + BLOCK_CHUNK_SIZE - 1n > latestBlock
        ? latestBlock
        : current + BLOCK_CHUNK_SIZE - 1n;

    chunkCount++;
    // Log progress every 100 chunks
    if (chunkCount % 100 === 0) {
      const pct = Number((current - startBlock) * 100n / totalBlocks);
      console.log(
        `[scanner] ${slug}: ${pct}% (block ${current}, ${result.eventsFound} events so far)`
      );
    }

    try {
      // Find the event ABI item for decoding
      const eventAbi = (abiEntry.abi as readonly Record<string, unknown>[]).find(
        (item) => item.type === "event" && item.name === abiEntry.creationEvent
      ) as AbiEvent;

      // Use the typed event overload of getLogs
      const logs = await publicClient.getLogs({
        address: factoryAddr as Address,
        event: eventAbi,
        fromBlock: current,
        toBlock: chunkEnd,
      });

      for (const log of logs as Log[]) {
        result.eventsFound++;

        try {
          // Decode the raw log using our ABI
          const decoded = decodeEventLog({
            abi: [eventAbi],
            data: log.data,
            topics: log.topics,
          });

          const parsed = abiEntry.parseCreationEvent(
            decoded.args as Record<string, unknown>
          );

          // Normalize to canonical lowercase
          const token0 = normalizeAddress(parsed.token0);
          const token1 = normalizeAddress(parsed.token1);
          const poolAddress = normalizeAddress(parsed.poolAddress);

          // Check if pool already exists
          const existing = await prisma.pool.findUnique({
            where: { address: poolAddress },
            select: { poolId: true },
          });

          if (existing) {
            result.poolsSkipped++;
            continue;
          }

          // Auto-create tokens if needed
          if (await ensureToken(token0)) result.tokensCreated++;
          if (await ensureToken(token1)) result.tokensCreated++;

          // Determine pool type
          let poolType = defaultPoolType;
          if (parsed.isStable !== undefined) {
            poolType = parsed.isStable ? "STABLE" : "V2";
          }

          // Create pool
          await prisma.pool.create({
            data: {
              slug,
              poolType,
              address: poolAddress,
              token0Addr: token0,
              token1Addr: token1,
              feeBps: parsed.feeBps ?? null,
              tickSpacing: parsed.tickSpacing ?? null,
              createdBlock: log.blockNumber ?? null,
              createdTx: log.transactionHash ?? null,
              status: "ACTIVE",
            },
          });

          result.poolsCreated++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Failed to process event in block ${log.blockNumber}: ${msg}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`getLogs failed for blocks ${current}→${chunkEnd}: ${msg}`);
      console.error(`[scanner] ${slug}: getLogs error at ${current}→${chunkEnd}:`, msg);
    }

    current = chunkEnd + 1n;

    // Rate limit delay between chunks
    if (current <= latestBlock && CHUNK_DELAY_MS > 0) {
      await delay(CHUNK_DELAY_MS);
    }
  }

  console.log(
    `[scanner] ${slug}: found ${result.eventsFound} events, ` +
      `created ${result.poolsCreated} pools, ` +
      `skipped ${result.poolsSkipped}, ` +
      `${result.tokensCreated} new tokens, ` +
      `${result.errors.length} errors`
  );

  return result;
}

// ---------------------------------------------------------------------------
// Scan All Protocols
// ---------------------------------------------------------------------------

/**
 * Scan all protocols that have FACTORY_EVENTS connectors.
 * Runs sequentially to avoid RPC rate limits.
 */
export async function scanAllProtocols(options?: {
  /** Override start block for all protocols */
  fromBlock?: bigint;
  /** Only scan these specific slugs */
  slugs?: string[];
}): Promise<ScanAllResult> {
  const { fromBlock, slugs } = options ?? {};

  const latestBlock = await publicClient.getBlockNumber();

  // Find all connectors with FACTORY_EVENTS discovery
  const where: Record<string, unknown> = {
    discoveryMethod: "FACTORY_EVENTS",
    protocol: { status: "ACTIVE" },
  };
  if (slugs?.length) {
    where.slug = { in: slugs };
  }

  const connectors = await prisma.protocolConnector.findMany({
    where,
    select: { slug: true },
    orderBy: { slug: "asc" },
  });

  console.log(
    `[scanner] Starting scan of ${connectors.length} protocols ` +
      `(latest block: ${latestBlock})`
  );

  const results: ScanResult[] = [];
  let totalPoolsCreated = 0;
  let totalTokensCreated = 0;
  let totalErrors = 0;

  for (const { slug } of connectors) {
    const scanResult = await scanProtocol(slug, fromBlock);
    results.push(scanResult);
    totalPoolsCreated += scanResult.poolsCreated;
    totalTokensCreated += scanResult.tokensCreated;
    totalErrors += scanResult.errors.length;
  }

  console.log(
    `[scanner] All scans complete: ${totalPoolsCreated} pools, ` +
      `${totalTokensCreated} tokens, ${totalErrors} errors`
  );

  return {
    timestamp: new Date().toISOString(),
    latestBlock,
    protocols: results,
    totalPoolsCreated,
    totalTokensCreated,
    totalErrors,
  };
}
